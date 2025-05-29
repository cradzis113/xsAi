const fs = require('fs');
const path = require('path');

// Sửa lại đường dẫn tới thư mục data
const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOG_FILE = path.join(DATA_DIR, 'prediction_history.txt');
const TEMP_FILE = path.join(DATA_DIR, 'temp_prediction.json');

// Đảm bảo thư mục data tồn tại
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Đảm bảo file log tồn tại
if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '=== LỊCH SỬ DỰ ĐOÁN ===\n\n');
}

function formatDateTime(date) {
    const pad = (num) => String(num).padStart(2, '0');
    
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    
    return `[${hours}:${minutes}:${seconds} ${day}/${month}/${year}]`;
}

function logPrediction(predictions, randomNumbers, probabilities, drawId) {
    const now = new Date();
    const dateTime = formatDateTime(now);
    
    // Create temporary prediction log
    const predictionData = {
        dateTime,
        gameId: drawId,
        predictions,
        randomNumbers,
        probabilities,
        result: null
    };
    
    // Store temporary prediction in memory or file
    fs.writeFileSync(TEMP_FILE, JSON.stringify(predictionData));
}

function verifyAndLogResult(actualResult, position, actualNumber) {
    try {
        // Read the temporary prediction
        const tempData = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));
        
        // Determine if prediction was correct
        const predicted = tempData.predictions[position] === 'T' ? 'Tai' : 'Xiu';
        const actual = actualResult === 'T' ? 'Tai' : 'Xiu';
        const isCorrect = tempData.predictions[position] === actualResult;
        
        // Format the log entry
        const logEntry = `${tempData.dateTime} - ${tempData.gameId} - Du doan: ${tempData.randomNumbers[position]} (${predicted}) | So thuc te: ${actualNumber} (${actual}) | [${isCorrect ? 'Dung' : 'Sai'}] | Vi tri: ${position}\n`;
        
        // Append to log file
        fs.appendFileSync(LOG_FILE, logEntry);
        
        return logEntry;
    } catch (error) {
        console.error('Lỗi khi kiểm tra kết quả:', error.message);
        return null;
    }
}

module.exports = {
    logPrediction,
    verifyAndLogResult
}; 