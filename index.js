const tf = require('@tensorflow/tfjs-node');
const path = require('path');
const fs = require('fs');
const predictionLogic = require('./logic/prediction_logic');
const crawlService = require('./services/crawlService');
const lotteryService = require('./services/lotteryService');
const connectDB = require('./config/database');
const MODEL_DIR = path.join(__dirname, 'tai_xiu_model');
const browserService = require('./services/browserService');
const predictionLogger = require('./logic/predictionLogger');

const CONFIG = {
    HISTORY_LENGTH: 8,
    MODEL_DIR: MODEL_DIR,
    CONFIDENCE_THRESHOLD: 0.8
};

// Biến lưu trữ models
let loadedModels = [];
let metadata = null;

/**
 * Load models từ thư mục
 */
async function loadModels() {
    try {
        const metadataPath = path.join(CONFIG.MODEL_DIR, 'metadata.json');
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        for (let i = 1; i <= metadata.models; i++) {
            const model = await tf.loadLayersModel(`file://${CONFIG.MODEL_DIR}/model_${i}/model.json`);
            loadedModels.push(model);
        }
        console.log(`Đã load ${metadata.models} models thành công`);
    } catch (error) {
        console.error('Lỗi khi load models:', error);
        throw error;
    }
}

/**
 * Thực hiện dự đoán cho lượt tiếp theo
 * @param {Function} getAllLotteryData Function lấy dữ liệu xổ số
 * @param {Array} loadedModels Các model đã được load
 * @returns {Object} Kết quả dự đoán
 */
async function makePrediction(getAllLotteryData, loadedModels) {
    try {
        // Lấy dữ liệu mới nhất
        const {data} = await getAllLotteryData();
        if (!data || data.length === 0) {
            throw new Error('Không có dữ liệu lịch sử');
        }

        // Sắp xếp dữ liệu theo thời gian mới nhất
        const sortedData = data.sort((a, b) => {
            const timeA = new Date(a.drawTime);
            const timeB = new Date(b.drawTime);
            return timeB - timeA;  // Sắp xếp giảm dần (mới nhất lên đầu)
        });

        const lastRecord = sortedData[0];  // Lấy record mới nhất
        
        // Kiểm tra dự đoán trước đó
        try {
            const tempData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'temp_prediction.json'), 'utf8'));
            const previousDrawId = tempData.gameId;
            
            // Tìm kết quả thực tế của lượt trước trong data
            const previousResult = sortedData.find(item => item.drawId === previousDrawId);
            
            if (previousResult) {
                console.log('\n=== KIỂM TRA DỰ ĐOÁN TRƯỚC ===');
                console.log(`DrawID: ${previousDrawId}`);
                console.log('Kết quả thực tế:', previousResult.numbers.join(','));
                
                // Kiểm tra từng vị trí và ghi log
                for (let i = 0; i < previousResult.numbers.length; i++) {
                    const actualNumber = parseInt(previousResult.numbers[i]);
                    const actualResult = actualNumber >= 5 ? 'T' : 'X';
                    predictionLogger.verifyAndLogResult(actualResult, i, actualNumber);
                }
                console.log('=== KẾT THÚC KIỂM TRA ===\n');
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('Chưa có dự đoán trước đó');
            }
        }

        console.log('\n=== DỰ ĐOÁN CHO LƯỢT TIẾP THEO ===');
        const nextDrawId = (parseInt(lastRecord.drawId) + 1).toString();
        console.log(`DrawID: ${nextDrawId}`);

        const { predictions, randomNumbers, probabilities } = await predictionLogic.analyzeTrends(sortedData, loadedModels);
        
        // Log the prediction với drawId của lượt tiếp theo
        predictionLogger.logPrediction(predictions, randomNumbers, probabilities, nextDrawId);

        console.log(`\nDự đoán: [${predictions.join(',')}]`);
        console.log(`Số đề xuất: [${randomNumbers.join(',')}]`);
        console.log(`Xác suất: [${probabilities.map(p => (p * 100).toFixed(1) + '%').join(', ')}]`);
    } catch (error) {
        console.error('Lỗi trong quá trình dự đoán:', error);
        throw error;
    }
}

async function runPredictions() {
    let retryCount = 0;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 30000; // 30 seconds

    while (retryCount < MAX_RETRIES) {
        try {
            if (loadedModels.length === 0) {
                await loadModels();
            }

            await connectDB();
            await crawlService.initializeScraper();
            
            // Interval để cập nhật dữ liệu
            const updateInterval = setInterval(async () => {
                try {
                    const results = await crawlService.scrapeVIPLotteryResults();
                    await lotteryService.saveNumbers(results);
                } catch (error) {
                    console.error('Lỗi cập nhật dữ liệu:', error);
                }
            }, 5000);

            const browser = await browserService.launchBrowser();
            const page = await browserService.openBettingPage(browser);

            // Truyền function getAllLotteryData và loadedModels
            browserService.getCountDownTime(
                page,
                async () => await makePrediction(lotteryService.getAllLotteryData, loadedModels, CONFIG.HISTORY_LENGTH)
            );

            // Reset retry count on successful initialization
            retryCount = 0;

            // Cleanup function
            const cleanup = async () => {
                clearInterval(updateInterval);
                if (browser && !browser.isConnected()) {
                    await browser.close();
                }
            };

            // Handle process termination
            process.on('SIGINT', async () => {
                console.log('Đang dọn dẹp...');
                await cleanup();
                process.exit(0);
            });

            return;

        } catch (error) {
            console.error('Lỗi khởi tạo:', error);
            retryCount++;

            if (retryCount < MAX_RETRIES) {
                console.log(`Thử lại lần ${retryCount} sau ${RETRY_DELAY/1000} giây...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            } else {
                console.error('Đã vượt quá số lần thử lại. Dừng chương trình.');
                process.exit(1);
            }
        }
    }
}

runPredictions();
