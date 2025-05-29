const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

// Đường dẫn
const DATA_FILE = path.join(__dirname, 'data', 'tai_xiu_data.csv');
const MODEL_OUTPUT_DIR = path.join(__dirname, 'tai_xiu_model');

function logWithTime(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

const CONFIG = {
    SEQUENCE_LENGTH: 5,
    LOOKBACK_WINDOW: 15,        // Giảm window size
    BATCH_SIZE: 32,            // Giảm batch size
    EPOCHS: 30,                // Giảm epochs
    LEARNING_RATE: 0.001,      // Giảm learning rate
    VALIDATION_SPLIT: 0.2,
    ENSEMBLE_SIZE: 3,          // Tăng số lượng models
    L2_REGULARIZATION: 0.005,  // Giảm regularization
    CLASS_WEIGHT: {            // Thêm class weights
        0: 1.0,               // Xỉu
        1: 1.0                // Tài (sẽ được tính động)
    }
};

function calculateFeatures(data, index) {
    const window = CONFIG.LOOKBACK_WINDOW;
    const sequence = data.slice(Math.max(0, index - window), index + 1);
    
    // Basic stats
    const taiCount = sequence.filter(x => x.value === 1).length;
    const taiRatio = taiCount / sequence.length;
    
    // Streak analysis
    let currentStreak = 1;
    let maxStreak = 1;
    let streakValue = data[index-1].value;
    
    for(let i = index - 2; i >= Math.max(0, index - 10); i--) {
        if(data[i].value === streakValue) {
            currentStreak++;
            maxStreak = Math.max(maxStreak, currentStreak);
        } else {
            break;
        }
    }
    
    // Time features
    const [hour, minute] = data[index].time.split(':').map(Number);
    const timeOfDay = hour / 24;
    const partOfHour = minute / 60;
    
    // Pattern analysis
    const pattern = sequence.slice(-5).map(x => x.value);
    const patternString = pattern.join('');
    const alternationCount = pattern.slice(1).reduce((count, curr, i) => 
        count + (curr !== pattern[i] ? 1 : 0), 0);
    
    // Momentum and trend
    const shortTerm = sequence.slice(-5).filter(x => x.value === 1).length / 5;
    const mediumTerm = sequence.slice(-10).filter(x => x.value === 1).length / 10;
    const momentum = shortTerm - mediumTerm;
    
    // Volatility
    const changes = sequence.slice(1).map((x, i) => 
        x.value !== sequence[i].value ? 1 : 0
    );
    const volatility = changes.reduce((a, b) => a + b, 0) / changes.length;
    
    return [
        taiRatio,                    // Overall ratio
        currentStreak / 10,          // Current streak (normalized)
        maxStreak / 10,              // Max streak (normalized)
        timeOfDay,                   // Time of day
        partOfHour,                  // Part of hour
        Math.sin(2 * Math.PI * hour / 24),  // Cyclical time
        Math.cos(2 * Math.PI * hour / 24),  // Cyclical time
        alternationCount / 4,        // Pattern alternation
        momentum,                    // Short-term momentum
        volatility,                  // Volatility
        shortTerm,                   // Short-term ratio
        mediumTerm                   // Medium-term ratio
    ];
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function prepareData() {
    // Read data
    const rawData = [];
    await new Promise((resolve) => {
        fs.createReadStream(DATA_FILE)
            .pipe(csv())
            .on('data', (row) => {
                rawData.push({
                    time: row.timestamp,
                    value: parseInt(row.tai_xiu)
                });
            })
            .on('end', resolve);
    });

    // Calculate class distribution
    const totalSamples = rawData.length;
    const taiSamples = rawData.filter(x => x.value === 1).length;
    const xiuSamples = totalSamples - taiSamples;
    
    logWithTime(`Class distribution - Tài: ${taiSamples}, Xỉu: ${xiuSamples}`);

    // Create features
    const features = [];
    const labels = [];
    
    for(let i = CONFIG.LOOKBACK_WINDOW; i < rawData.length; i++) {
        features.push(calculateFeatures(rawData, i));
        labels.push(rawData[i].value);
    }

    // Balance dataset by undersampling majority class
    const taiIndices = [];
    const xiuIndices = [];
    
    for(let i = 0; i < labels.length; i++) {
        if(labels[i] === 1) {
            taiIndices.push(i);
        } else {
            xiuIndices.push(i);
        }
    }
    
    const minCount = Math.min(taiIndices.length, xiuIndices.length);
    
    // Randomly sample from both classes
    const selectedTaiIndices = shuffleArray([...taiIndices]).slice(0, minCount);
    const selectedXiuIndices = shuffleArray([...xiuIndices]).slice(0, minCount);
    
    // Combine and shuffle
    const balancedIndices = shuffleArray([...selectedTaiIndices, ...selectedXiuIndices]);
    
    // Create balanced dataset
    const balancedFeatures = balancedIndices.map(i => features[i]);
    const balancedLabels = balancedIndices.map(i => labels[i]);
    
    logWithTime(`Balanced dataset size: ${balancedFeatures.length} samples (${minCount} per class)`);

    // Split data
    const splitIndex = Math.floor(balancedFeatures.length * (1 - CONFIG.VALIDATION_SPLIT));
    
    const trainFeatures = balancedFeatures.slice(0, splitIndex);
    const trainLabels = balancedLabels.slice(0, splitIndex);
    const valFeatures = balancedFeatures.slice(splitIndex);
    const valLabels = balancedLabels.slice(splitIndex);

    return {
        train: {
            features: trainFeatures,
            labels: trainLabels
        },
        validation: {
            features: valFeatures,
            labels: valLabels
        },
        inputShape: [features[0].length]
    };
}

function createModel(inputShape) {
    const model = tf.sequential();
    
    // Input layer with batch normalization
    model.add(tf.layers.dense({
        units: 24,
        activation: 'relu',
        inputShape: [inputShape],
        kernelRegularizer: tf.regularizers.l2({l2: CONFIG.L2_REGULARIZATION})
    }));
    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.dropout(0.3));
    
    // Hidden layer with residual connection
    model.add(tf.layers.dense({
        units: 12,
        activation: 'relu',
        kernelRegularizer: tf.regularizers.l2({l2: CONFIG.L2_REGULARIZATION})
    }));
    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.dropout(0.2));
    
    // Output layer
    model.add(tf.layers.dense({
        units: 1,
        activation: 'sigmoid',
        kernelRegularizer: tf.regularizers.l2({l2: CONFIG.L2_REGULARIZATION})
    }));
    
    const optimizer = tf.train.adam(CONFIG.LEARNING_RATE);
    
    model.compile({
        optimizer: optimizer,
        loss: 'binaryCrossentropy',
        metrics: ['accuracy']
    });

    return model;
}

class EnsembleModel {
    constructor(inputShape) {
        this.models = Array(CONFIG.ENSEMBLE_SIZE).fill(null)
            .map(() => createModel(inputShape));
        this.lastEvaluation = null;
    }
    
    async train(data) {
        logWithTime('Bắt đầu training ensemble models...');
        
        const trainTensors = {
            features: tf.tensor2d(data.train.features),
            labels: tf.tensor1d(data.train.labels)
        };
        
        const valTensors = {
            features: tf.tensor2d(data.validation.features),
            labels: tf.tensor1d(data.validation.labels)
        };
        
        try {
            const promises = this.models.map((model, index) => {
                return model.fit(trainTensors.features, trainTensors.labels, {
                    epochs: CONFIG.EPOCHS,
            batchSize: CONFIG.BATCH_SIZE,
                    validationData: [valTensors.features, valTensors.labels],
                    verbose: 1,
            callbacks: {
                        onEpochEnd: (epoch, logs) => {
                            if ((epoch + 1) % 5 === 0) {
                                logWithTime(`Model ${index + 1} - Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(4)}, acc = ${(logs.acc * 100).toFixed(2)}%, val_acc = ${(logs.val_acc * 100).toFixed(2)}%`);
                            }
                }
            }
        });
            });
            
            await Promise.all(promises);
            logWithTime('Ensemble training completed successfully');
            
            // Evaluate ensemble performance
            await this.evaluatePerformance(data.validation.features, data.validation.labels);
            
        } catch (error) {
            logWithTime(`Training error: ${error.message}`);
            throw error;
            
        } finally {
            // Cleanup tensors
            trainTensors.features.dispose();
            trainTensors.labels.dispose();
            valTensors.features.dispose();
            valTensors.labels.dispose();
        }
    }
    
    async evaluatePerformance(features, labels) {
        logWithTime('\n=== ĐÁNH GIÁ HIỆU SUẤT MÔ HÌNH ===');
        
        const predictions = [];
        let correct = 0;
        let taiCorrect = 0;
        let xiuCorrect = 0;
        let taiTotal = 0;
        let xiuTotal = 0;
        
        // Convert features to tensor
        const featuresTensor = tf.tensor2d(features);
        
        try {
            // Get predictions from all models
            for(let i = 0; i < features.length; i++) {
                const sampleFeatures = featuresTensor.slice([i, 0], [1, -1]);
                const prediction = this.models.map(model => 
                    model.predict(sampleFeatures).dataSync()[0]
                ).reduce((a, b) => a + b) / this.models.length;
                
                const predictedClass = prediction > 0.5 ? 1 : 0;
                const actualClass = labels[i];
                
                predictions.push({
                    predicted: predictedClass,
                    actual: actualClass,
                    confidence: prediction
                });
                
                if(predictedClass === actualClass) {
                    correct++;
                    if(actualClass === 1) taiCorrect++;
                    else xiuCorrect++;
                }
                
                if(actualClass === 1) taiTotal++;
                else xiuTotal++;
                
                sampleFeatures.dispose();
            }
            
            // Calculate metrics
            const accuracy = (correct / labels.length) * 100;
            const taiAccuracy = (taiCorrect / taiTotal) * 100;
            const xiuAccuracy = (xiuCorrect / (labels.length - taiTotal)) * 100;
            
            // Calculate streaks
            let currentStreak = 0;
            let longestStreak = 0;
            
            for(const pred of predictions) {
                if(pred.predicted === pred.actual) {
                    currentStreak++;
                    longestStreak = Math.max(longestStreak, currentStreak);
                } else {
                    currentStreak = 0;
                }
            }
            
            // Save evaluation results
            this.lastEvaluation = {
                metrics: {
                    total_samples: labels.length,
                    overall_accuracy: accuracy,
                    tai_accuracy: taiAccuracy,
                    xiu_accuracy: xiuAccuracy,
                    longest_streak: longestStreak,
                    high_confidence_accuracy: predictions.filter(p => 
                        Math.abs(p.confidence - 0.5) > 0.3
                    ).length > 0 ? 
                        (predictions.filter(p => 
                            p.predicted === p.actual
                        ).length / predictions.filter(p => 
                            Math.abs(p.confidence - 0.5) > 0.3
                        ).length) * 100 : null
                },
                predictions: predictions.slice(0, 10)
            };
            
            // Log results
            logWithTime(`Tổng số mẫu: ${labels.length}`);
            logWithTime(`Độ chính xác tổng thể: ${accuracy.toFixed(2)}%`);
            logWithTime(`Độ chính xác Tài: ${taiAccuracy.toFixed(2)}% (${taiCorrect}/${taiTotal})`);
            logWithTime(`Độ chính xác Xỉu: ${xiuAccuracy.toFixed(2)}% (${xiuCorrect}/${(labels.length - taiTotal)})`);
            logWithTime(`Chuỗi dự đoán đúng dài nhất: ${longestStreak}`);
            
            // Calculate high confidence predictions
            const highConfPreds = predictions.filter(p => 
                Math.abs(p.confidence - 0.5) > 0.3
            );
            const highConfCorrect = highConfPreds.filter(p => 
                p.predicted === p.actual
            ).length;
            
            if(highConfPreds.length > 0) {
                const highConfAcc = (highConfCorrect / highConfPreds.length) * 100;
                logWithTime(`Độ chính xác với độ tin cậy cao (>80%): ${highConfAcc.toFixed(2)}% (${highConfCorrect}/${highConfPreds.length})`);
            }
            
        } finally {
            featuresTensor.dispose();
        }
    }
    
    predict(features) {
        const inputTensor = tf.tensor2d([features]);
        const predictions = this.models.map(model => 
            model.predict(inputTensor).dataSync()[0]
        );
        inputTensor.dispose();
        return predictions.reduce((a, b) => a + b) / predictions.length;
    }
    
    async save(directory) {
        for(let i = 0; i < this.models.length; i++) {
            await this.models[i].save(`file://${directory}/model_${i + 1}`);
        }
    }
}

async function main() {
    try {
        logWithTime('Starting model training...');
        const data = await prepareData();
        
        // Create output directory if it doesn't exist
        if (!fs.existsSync(MODEL_OUTPUT_DIR)) {
            fs.mkdirSync(MODEL_OUTPUT_DIR, { recursive: true });
        }
        
        const ensemble = new EnsembleModel(data.inputShape[0]);
        await ensemble.train(data);

        // Save models and metadata
        await ensemble.save(MODEL_OUTPUT_DIR);
        
        // Create metadata
        const metadata = {
            version: "4.0.2",
            type: "ensemble",
            models: CONFIG.ENSEMBLE_SIZE,
            features: {
                count: data.inputShape[0],
                description: [
                    "Overall Tai ratio",
                    "Current streak",
                    "Max streak", 
                    "Time of day",
                    "Part of hour",
                    "Sin time",
                    "Cos time",
                    "Pattern alternation",
                    "Momentum",
                    "Volatility",
                    "Short-term ratio",
                    "Medium-term ratio"
                ]
            },
            config: CONFIG,
            performance: ensemble.lastEvaluation || null
        };

        fs.writeFileSync(
            path.join(MODEL_OUTPUT_DIR, 'metadata.json'),
            JSON.stringify(metadata, null, 2)
        );
        
        logWithTime('Training completed successfully!');
    } catch (error) {
        logWithTime('Error during training: ' + error.message);
        throw error;
    }
}

// Run
main().catch(err => {
    logWithTime(`FATAL ERROR: ${err.message}`);
    console.error(err);
    process.exit(1);
}); 