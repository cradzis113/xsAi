const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

// Thêm function để log với timestamp
function logWithTime(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

// Constants for model configuration
const CONFIG = {
    SEQUENCE_LENGTH: 15,          // Tăng sequence length
    LOOKBACK_WINDOW: 30,         // Tăng window size
    BATCH_SIZE: 64,              // Tăng batch size
    EPOCHS: 150,                 // Tăng số epochs
    LEARNING_RATE: 0.001,        // Tăng learning rate ban đầu
    VALIDATION_SPLIT: 0.2,
    MIN_DELTA: 0.0001,           // Early stopping delta
    PATIENCE: 15                 // Early stopping patience
};

// Function để kiểm tra file tồn tại
function checkFileExists(filePath) {
    try {
        logWithTime(`Kiểm tra file ${filePath}...`);
        return fs.existsSync(filePath);
    } catch(err) {
        logWithTime(`Lỗi khi kiểm tra file ${filePath}: ${err.message}`);
        return false;
    }
}

// Function để đảm bảo thư mục tồn tại
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        logWithTime(`Tạo thư mục ${dirPath}...`);
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// Function để tính streak
function calculateStreak(arr, index) {
    let streak = 1;
    const currentValue = arr[index].value;
    
    // Đếm ngược từ vị trí hiện tại
    for(let i = index - 1; i >= 0; i--) {
        if(arr[i].value === currentValue) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

// Function để tính moving average
function calculateMovingAverage(arr, index, window) {
    const start = Math.max(0, index - window + 1);
    const sequence = arr.slice(start, index + 1);
    const sum = sequence.reduce((acc, curr) => acc + curr.value, 0);
    return sum / sequence.length;
}

// Function để tính volatility (độ biến động)
function calculateVolatility(arr, index, window) {
    const start = Math.max(0, index - window + 1);
    const sequence = arr.slice(start, index + 1);
    const values = sequence.map(item => item.value);
    const mean = values.reduce((a, b) => a + b) / values.length;
    const squaredDiffs = values.map(x => Math.pow(x - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b) / values.length);
}

// Function để tính tỷ lệ trong N lượt gần nhất
function calculateRatio(arr, index, window = CONFIG.LOOKBACK_WINDOW) {
    const start = Math.max(0, index - window + 1);
    const sequence = arr.slice(start, index + 1);
    const taiCount = sequence.filter(item => item.value === 1).length;
    return taiCount / sequence.length;
}

// Function để chuyển thời gian thành features
function timeToFeatures(timeStr) {
    const [hour, minute] = timeStr.split(':').map(Number);
    
    // Thêm các features thời gian mới
    const timeOfDay = hour / 24; // Normalized hour (0-1)
    const partOfHour = minute / 60; // Normalized minute (0-1)
    const isRushHour = (hour >= 9 && hour <= 11) || (hour >= 13 && hour <= 15) ? 1 : 0;
    const sinTime = Math.sin(2 * Math.PI * hour / 24); // Cyclical time feature
    const cosTime = Math.cos(2 * Math.PI * hour / 24); // Cyclical time feature
    
    return [timeOfDay, partOfHour, isRushHour, sinTime, cosTime];
}

// Function để convert log file sang CSV
function convertLogToCSV() {
    console.log('Đang chuyển đổi log file sang CSV...');
    const logContent = fs.readFileSync('prediction_log.txt', 'utf8');
    const lines = logContent.split('\n');

    // Prepare CSV data
    let csvContent = 'timestamp,tai_xiu\n';

    // Process each line
    lines.forEach(line => {
        if (line.trim() === '') return;
        
        // Extract timestamp
        const timestamp = line.match(/\[(.*?)\]/)?.[1]?.split(' ')?.[0];
        
        // Extract actual number and convert to Tai/Xiu
        const actualMatch = line.match(/So thuc te: (\d+) \((Tai|Xiu)\)/);
        if (actualMatch && timestamp) {
            const number = parseInt(actualMatch[1]);
            const taiXiuValue = number >= 5 ? 1 : 0;
            csvContent += `${timestamp},${taiXiuValue}\n`;
        }
    });

    // Write to CSV file
    fs.writeFileSync('tai_xiu_data.csv', csvContent);
    console.log('Đã tạo file tai_xiu_data.csv thành công');
}

async function prepareData() {
    const data = [];
    let rowCount = 0;
    
    logWithTime('Bắt đầu đọc dữ liệu từ CSV...');
    
    // Đọc file CSV
    await new Promise((resolve) => {
        fs.createReadStream('tai_xiu_data.csv')
            .pipe(csv())
            .on('data', (row) => {
                data.push({
                    time: row.timestamp,
                    value: parseInt(row.tai_xiu)
                });
                rowCount++;
                if (rowCount % 1000 === 0) {
                    logWithTime(`Đã đọc ${rowCount} dòng dữ liệu...`);
                }
            })
            .on('end', () => {
                logWithTime(`Hoàn thành đọc ${rowCount} dòng dữ liệu`);
                resolve();
            });
    });

    // Tạo features và sequences
    const sequences = [];
    const labels = [];
    
    for (let i = CONFIG.LOOKBACK_WINDOW; i < data.length - CONFIG.SEQUENCE_LENGTH; i++) {
        const sequence = [];
        
        // Thêm features cho mỗi timestep trong sequence
        for(let j = 0; j < CONFIG.SEQUENCE_LENGTH; j++) {
            const idx = i - CONFIG.SEQUENCE_LENGTH + j;
            const timeFeatures = timeToFeatures(data[idx].time);
            const streak = calculateStreak(data, idx);
            const ratio = calculateRatio(data, idx);
            const ma5 = calculateMovingAverage(data, idx, 5);
            const ma10 = calculateMovingAverage(data, idx, 10);
            const ma20 = calculateMovingAverage(data, idx, 20);
            const volatility = calculateVolatility(data, idx, 10);
            
            // Gộp tất cả features
            sequence.push([
                data[idx].value,          // Giá trị Tài/Xỉu
                ...timeFeatures,          // 5 time features
                streak / 10,              // Streak (normalized)
                ratio,                    // Tỷ lệ Tài
                ma5,                      // Moving average 5
                ma10,                     // Moving average 10
                ma20,                     // Moving average 20
                volatility               // Volatility
            ]);
        }
        
        sequences.push(sequence);
        labels.push(data[i].value);
    }

    // Chuyển đổi thành tensors
    const xs = tf.tensor3d(sequences);
    const ys = tf.tensor1d(labels);

    return {
        inputs: xs,
        outputs: ys,
        totalSamples: sequences.length
    };
}

async function createAndTrainModel(data) {
    logWithTime('Bắt đầu tạo model...');
    
    // Tạo model với kiến trúc phức tạp hơn
    const model = tf.sequential();
    
    const timesteps = CONFIG.SEQUENCE_LENGTH;
    const features = 12;  // Số features mới

    // First Bidirectional LSTM layer
    model.add(tf.layers.bidirectional({
        layer: tf.layers.lstm({
            units: 128,
            returnSequences: true
        }),
        inputShape: [timesteps, features]
    }));
    
    model.add(tf.layers.layerNormalization());
    model.add(tf.layers.dropout(0.3));
    
    // Second Bidirectional LSTM layer
    model.add(tf.layers.bidirectional({
        layer: tf.layers.lstm({
            units: 64,
            returnSequences: false
        })
    }));
    
    model.add(tf.layers.layerNormalization());
    model.add(tf.layers.dropout(0.2));
    
    // Dense layers with skip connections
    const dense1 = tf.layers.dense({
        units: 32,
        activation: 'relu'
    });
    model.add(dense1);
    
    model.add(tf.layers.dropout(0.1));
    
    // Additional dense layer for better feature extraction
    model.add(tf.layers.dense({
        units: 16,
        activation: 'relu'
    }));
    
    // Output layer
    model.add(tf.layers.dense({
        units: 1,
        activation: 'sigmoid'
    }));

    // Training configuration
    const initialLearningRate = CONFIG.LEARNING_RATE;
    let currentLearningRate = initialLearningRate;
    const decayRate = 0.95;
    const minLearningRate = 0.00001;
    
    let bestValLoss = Infinity;
    let patienceCount = 0;
    const maxPatience = CONFIG.PATIENCE;
    let bestModelWeights = null;

    // Khởi tạo optimizer
    let optimizer = tf.train.adamax(currentLearningRate);
    
    model.compile({
        optimizer: optimizer,
        loss: 'binaryCrossentropy',
        metrics: ['accuracy']
    });

    // Prepare validation data
    const numValidation = Math.floor(data.inputs.shape[0] * CONFIG.VALIDATION_SPLIT);
    const numTrain = data.inputs.shape[0] - numValidation;
    
    const trainInputs = data.inputs.slice([0, 0, 0], [numTrain, -1, -1]);
    const trainOutputs = data.outputs.slice([0], [numTrain]);
    const valInputs = data.inputs.slice([numTrain, 0, 0], [-1, -1, -1]);
    const valOutputs = data.outputs.slice([numTrain], [-1]);

    // Training history
    const history = {
        loss: [],
        acc: [],
        val_loss: [],
        val_acc: [],
        lr: []
    };

    // Training loop
    for (let epoch = 0; epoch < CONFIG.EPOCHS; epoch++) {
        console.log(`\nEpoch ${epoch + 1}/${CONFIG.EPOCHS}`);
        console.log('==================================');
        
        // Training step with progress callback
        const trainResult = await model.fit(trainInputs, trainOutputs, {
            batchSize: CONFIG.BATCH_SIZE,
            shuffle: true,
            epochs: 1,
            verbose: 1, // Thay đổi từ 0 thành 1 để hiển thị progress bar
            callbacks: {
                onBatchEnd: async (batch, logs) => {
                    await tf.nextFrame(); // Cho phép UI cập nhật
                }
            }
        });

        // Validation step
        const valResult = await model.evaluate(valInputs, valOutputs, {
            batchSize: CONFIG.BATCH_SIZE,
            verbose: 0
        });

        // Convert tensor values to numbers
        const trainLoss = Number(trainResult.history.loss[0]);
        const trainAcc = Number(trainResult.history.acc[0]);
        const valLoss = Number(valResult[0].dataSync()[0]);
        const valAcc = Number(valResult[1].dataSync()[0]);

        // Update history
        history.loss.push(trainLoss);
        history.acc.push(trainAcc);
        history.val_loss.push(valLoss);
        history.val_acc.push(valAcc);
        history.lr.push(currentLearningRate);

        // Log progress với format dễ đọc
        console.log('\nKết quả:');
        console.log('----------------------------------');
        console.log(`Loss:      ${trainLoss.toFixed(4)} (train) | ${valLoss.toFixed(4)} (val)`);
        console.log(`Accuracy:  ${(trainAcc * 100).toFixed(2)}% (train) | ${(valAcc * 100).toFixed(2)}% (val)`);
        console.log(`Learning rate: ${currentLearningRate.toFixed(6)}`);

        // Check for improvement
        if (valLoss < bestValLoss) {
            console.log('\n✓ Cải thiện! Lưu trọng số mới');
            bestValLoss = valLoss;
            patienceCount = 0;
            bestModelWeights = model.getWeights().map(w => w.clone());
        } else {
            patienceCount++;
            
            // Learning rate decay
            if (patienceCount % 5 === 0 && currentLearningRate > minLearningRate) {
                currentLearningRate *= decayRate;
                // Tạo optimizer mới với learning rate mới
                optimizer = tf.train.adamax(currentLearningRate);
                model.compile({
                    optimizer: optimizer,
                    loss: 'binaryCrossentropy',
                    metrics: ['accuracy']
                });
                console.log(`\n→ Giảm learning rate xuống ${currentLearningRate.toFixed(6)}`);
            }
            
            // Early stopping
            if (patienceCount >= maxPatience) {
                console.log(`\n! Dừng sớm tại epoch ${epoch + 1} do không cải thiện`);
                break;
            }
        }

        // Clean up tensors
        valResult[0].dispose();
        valResult[1].dispose();
    }

    // Restore best model weights
    if (bestModelWeights !== null) {
        model.setWeights(bestModelWeights);
        console.log('\nRestored best model weights\n');
    }

    // Update metrics
    const metrics = {
        model_info: {
            name: "TaiXiu_Predictor_BiLSTM",
            version: "3.0.2",
            created_at: new Date().toISOString(),
            framework: "tensorflow.js",
            framework_version: tf.version.tfjs
        },
        architecture: {
            type: "Bidirectional_LSTM",
            input_shape: [timesteps, features],
            layers: [
                {
                    type: "Bidirectional_LSTM",
                    units: 128,
                    return_sequences: true
                },
                {
                    type: "LayerNormalization"
                },
                {
                    type: "Dropout",
                    rate: 0.3
                },
                {
                    type: "Bidirectional_LSTM",
                    units: 64,
                    return_sequences: false
                },
                {
                    type: "LayerNormalization"
                },
                {
                    type: "Dropout",
                    rate: 0.2
                },
                {
                    type: "Dense",
                    units: 32,
                    activation: "relu"
                },
                {
                    type: "Dropout",
                    rate: 0.1
                },
                {
                    type: "Dense",
                    units: 16,
                    activation: "relu"
                },
                {
                    type: "Dense",
                    units: 1,
                    activation: "sigmoid"
                }
            ]
        },
        training_params: {
            optimizer: "adamax",
            initial_learning_rate: initialLearningRate,
            min_learning_rate: minLearningRate,
            decay_rate: decayRate,
            loss_function: "binaryCrossentropy",
            batch_size: CONFIG.BATCH_SIZE,
            epochs: CONFIG.EPOCHS,
            validation_split: CONFIG.VALIDATION_SPLIT,
            early_stopping: {
                min_delta: CONFIG.MIN_DELTA,
                patience: CONFIG.PATIENCE
            }
        },
        features: {
            sequence_length: CONFIG.SEQUENCE_LENGTH,
            feature_description: [
                "Tai/Xiu value (0/1)",
                "Time of day (normalized 0-1)",
                "Part of hour (normalized 0-1)",
                "Is rush hour (0/1)",
                "Sine time",
                "Cosine time",
                "Streak (normalized)",
                "Tai ratio in window",
                "Moving average 5",
                "Moving average 10",
                "Moving average 20",
                "Volatility"
            ]
        },
        performance_metrics: {
            training_samples: numTrain,
            validation_samples: numValidation,
            final_accuracy: history.acc[history.acc.length - 1],
            final_loss: history.loss[history.loss.length - 1],
            validation_accuracy: history.val_acc[history.val_acc.length - 1],
            validation_loss: history.val_loss[history.val_loss.length - 1],
            best_validation_accuracy: Math.max(...history.val_acc),
            best_validation_loss: bestValLoss,
            learning_rate_history: history.lr
        },
        usage: {
            input_format: `Sequence of ${CONFIG.SEQUENCE_LENGTH} timesteps with ${features} features each`,
            output_format: "Probability of Tai (0-1)",
            threshold: 0.5,
            interpretation: {
                above_threshold: "Tai",
                below_threshold: "Xiu"
            }
        }
    };

    // Lưu metrics vào file
    const modelDir = './tai_xiu_model';
    ensureDirectoryExists(modelDir);
    const metricsPath = path.join(modelDir, 'metrics.json');
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
    console.log('Đã lưu metrics vào file metrics.json');

    logWithTime('Đã tạo xong cấu trúc model');
    logWithTime(`Số lượng mẫu training: ${numTrain}`);
    logWithTime(`Số lượng mẫu validation: ${numValidation}`);

    return model;
}

async function main() {
    try {
        logWithTime('=== BẮT ĐẦU CHƯƠNG TRÌNH ===');
        
        // Kiểm tra file prediction_log.txt
        if (!checkFileExists('prediction_log.txt')) {
            logWithTime('ERROR: Không tìm thấy file prediction_log.txt');
            logWithTime('Vui lòng đảm bảo file log tồn tại trước khi chạy chương trình');
            return;
        }

        // Kiểm tra và tạo file CSV nếu cần
        if (!checkFileExists('tai_xiu_data.csv')) {
            logWithTime('Chưa có file CSV, tiến hành chuyển đổi từ log file...');
            convertLogToCSV();
        }

        // Chuẩn bị dữ liệu
        logWithTime('Đang chuẩn bị dữ liệu...');
        const data = await prepareData();
        logWithTime(`Tổng số mẫu: ${data.totalSamples}`);

        // Train model
        logWithTime('=== BẮT ĐẦU TRAINING ===');
        const model = await createAndTrainModel(data);

        // Lưu model
        logWithTime('Đang lưu model...');
        await model.save('file://./tai_xiu_model');
        logWithTime('Đã lưu model vào thư mục tai_xiu_model');
        logWithTime('=== HOÀN THÀNH ===');
    } catch (error) {
        logWithTime(`ERROR: ${error.message}`);
        console.error(error);
    }
}

// Chạy chương trình
logWithTime('Khởi động chương trình...');
main().catch(err => {
    logWithTime(`FATAL ERROR: ${err.message}`);
    console.error(err);
}); 