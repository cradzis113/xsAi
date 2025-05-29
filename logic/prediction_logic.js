const tf = require('@tensorflow/tfjs-node');

/**
 * Chuyển đổi dữ liệu MongoDB thành mảng 0/1 cho một vị trí cụ thể
 */
function processMongoData(data, position) {
    return data.map(record => {
        const number = parseInt(record.numbers[position]);
        return number >= 5 ? 1 : 0;
    });
}

/**
 * Tính toán features từ lịch sử cho một vị trí cụ thể
 */
function calculateFeatures(history, position, CONFIG) {
    if (history.length < CONFIG.HISTORY_LENGTH) {
        return null;
    }

    const sequence = history.slice(-CONFIG.HISTORY_LENGTH);
    
    // Tính các chỉ số cơ bản
    const taiCount = sequence.filter(x => x === 1).length;
    const taiRatio = taiCount / sequence.length;

    // Phân tích streak
    let currentStreak = 1;
    let maxStreak = 1;
    let streakValue = sequence[sequence.length - 1];
    for(let i = sequence.length - 2; i >= 0; i--) {
        if(sequence[i] === streakValue) {
            currentStreak++;
            maxStreak = Math.max(maxStreak, currentStreak);
        } else break;
    }

    // Thời gian
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // Phân tích xu hướng
    const shortTerm = sequence.slice(-5).filter(x => x === 1).length / 5;
    const mediumTerm = sequence.slice(-10).filter(x => x === 1).length / 10;
    const momentum = shortTerm - mediumTerm;

    // Phân tích tương quan với các vị trí khác
    const positionWeight = (position + 1) / 5; // Trọng số dựa vào vị trí (0.2 -> 1.0)

    // Trả về 12 features với đặc trưng cho từng vị trí
    return [
        taiRatio,                              // Tỉ lệ tổng
        currentStreak / 10,                    // Chuỗi hiện tại
        maxStreak / 10,                        // Chuỗi dài nhất
        hour / 24,                             // Thời gian trong ngày
        minute / 60,                           // Phút trong giờ
        Math.sin(2 * Math.PI * hour / 24),     // Chu kỳ thời gian
        Math.cos(2 * Math.PI * hour / 24),     // Chu kỳ thời gian
        sequence.slice(-3).filter(x => x === 1).length / 3,  // Xu hướng gần
        sequence.slice(-5).filter(x => x === 1).length / 5,  // Xu hướng ngắn
        momentum * positionWeight,              // Động lượng theo vị trí
        shortTerm * positionWeight,             // Tỉ lệ ngắn hạn theo vị trí
        mediumTerm * positionWeight            // Tỉ lệ trung hạn theo vị trí
    ];
}

/**
 * Dự đoán Tài/Xỉu cho lượt tiếp theo
 */
async function predictTaiXiu(mongoData, position, loadedModels) {
    try {
        const history = processMongoData(mongoData, position);
        const features = calculateFeatures(history, position, {HISTORY_LENGTH: 10});
        
        if (!features) {
            throw new Error('Không đủ dữ liệu lịch sử để dự đoán');
        }

        // Dự đoán
        const featureTensor = tf.tensor2d([features]);
        const predictions = await Promise.all(
            loadedModels.map(model => model.predict(featureTensor).data())
        );
        featureTensor.dispose();

        // Tính xác suất trung bình từ các models
        const avgPrediction = predictions.reduce((a, b) => a + b[0], 0) / loadedModels.length;

        // Điều chỉnh xác suất dựa vào vị trí
        const positionBias = (position - 2) * 0.05; // Vị trí giữa (2) là trung tính
        const adjustedPrediction = Math.min(Math.max(avgPrediction + positionBias, 0.1), 0.9);

        return {
            prediction: adjustedPrediction > 0.5 ? 'Tài' : 'Xỉu',
            probability: adjustedPrediction,
            confidence: Math.abs(adjustedPrediction - 0.5) * 2
        };
    } catch (error) {
        console.error('Lỗi khi dự đoán:', error);
        throw error;
    }
}

/**
 * Tạo số ngẫu nhiên trong khoảng cho trước
 */
function getRandomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Phân tích xu hướng và dự đoán cho tất cả các vị trí
 * @param {Array} sampleData Dữ liệu mẫu để phân tích
 * @param {Array} loadedModels Các model đã được load
 * @param {number} recentCount Số lượng kết quả gần nhất cần xem xét (mặc định: 5)
 */
async function analyzeTrends(sampleData, loadedModels, recentCount = 5) {
    if (sampleData.length < recentCount) {
        throw new Error(`Không đủ dữ liệu để phân tích. Cần ít nhất ${recentCount} kết quả.`);
    }

    // Lấy N kết quả gần nhất theo recentCount
    const recentNumbers = sampleData.slice(0, recentCount).map(record => record.numbers);
    const positionTrends = Array(5).fill(0).map((_, pos) => {
        const positionNumbers = recentNumbers.map(nums => parseInt(nums[pos]));
        return positionNumbers.filter(n => n >= 5).length / recentCount;
    });

    const predictions = [];
    const randomNumbers = [];
    const probabilities = [];

    for (let i = 0; i < 5; i++) {
        const result = await predictTaiXiu(sampleData, i, loadedModels);
        
        // Điều chỉnh dự đoán dựa trên xu hướng vị trí
        const trendBias = (positionTrends[i] - 0.5) * 0.2;
        const finalProb = Math.min(Math.max(result.probability + trendBias, 0.1), 0.9);
        
        const isTai = finalProb > 0.5;
        predictions.push(isTai ? 'T' : 'X');
        probabilities.push(finalProb);
        
        // Tạo số ngẫu nhiên trong khoảng Tài (5-9) hoặc Xỉu (0-4)
        const randomNum = isTai ? getRandomNumber(5, 9) : getRandomNumber(0, 4);
        randomNumbers.push(randomNum);
    }

    // Log thông tin để debug
    console.log('\nThông tin xu hướng:');
    console.log(`${recentCount} kết quả gần nhất:`, recentNumbers);
    console.log('Xu hướng theo vị trí:', positionTrends.map(t => (t * 100).toFixed(1) + '%'));

    return {
        predictions,
        randomNumbers,
        probabilities
    };
}

module.exports = {
    predictTaiXiu,
    analyzeTrends,
    processMongoData,
    calculateFeatures,
    getRandomNumber
}; 