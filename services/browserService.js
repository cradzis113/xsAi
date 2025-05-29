const puppeteer = require('puppeteer-core');
const os = require('os');

// Cấu hình đường dẫn Chrome dựa trên hệ điều hành
function getChromePath() {
    return os.platform() === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/usr/bin/google-chrome';
}

const CONFIG = {
    CHROME_PATH: getChromePath(),
    URL: 'https://bet.6nluck8.cc/home/?inviteCode=4592386#/lottery?tabName=Lottery&id=47',
    SELECTORS: {
        secondLastDigit: '._timeDown .vue-count-time .time span:nth-last-child(2)',
        lastDigit: '._timeDown .vue-count-time .time span:last-child'
    }
};

/**
 * Khởi tạo trình duyệt với cấu hình tối thiểu
 */
async function launchBrowser() {
    const isLinux = os.platform() === 'linux';
    const browser = await puppeteer.launch({
        executablePath: CONFIG.CHROME_PATH,
        headless: true,
        args: [
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            ...(isLinux ? ['--window-size=1920x1080'] : [])
        ]
    });
    return browser;
}

/**
 * Mở trang cá cược và thiết lập cấu hình cơ bản
 */
async function openBettingPage(browser) {
    try {
        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(60000);

        await page.goto(CONFIG.URL, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        return page;
    } catch (error) {
        console.error('Lỗi khi mở trang betting:', error.message);
        throw error;
    }
}

/**
 * Theo dõi thời gian đếm ngược và thực hiện dự đoán
 * @param {Page} page - Trang web đang mở
 * @param {Function} predictFunction - Hàm dự đoán số
 */
async function getCountDownTime(page, predictFunction) {
    console.log('✅ Bắt đầu theo dõi countdown...');

    let isPredicting = false;
    let hasPredicted = false;
    let lastSeconds = -1;
    let errorCount = 0;
    const MAX_ERRORS = 5;
    const ERROR_RESET_INTERVAL = 60000; // 1 phút

    const intervalId = setInterval(async () => {
        if (page.isClosed()) {
            console.log('❌ Page đã bị đóng, dừng theo dõi countdown');
            clearInterval(intervalId);
            return;
        }

        try {
            // Reset error count periodically
            if (errorCount > 0) {
                setTimeout(() => {
                    errorCount = 0;
                }, ERROR_RESET_INTERVAL);
            }

            // Lấy thời gian đếm ngược
            const [secondLastDigit, lastDigit] = await Promise.all([
                page.$eval(CONFIG.SELECTORS.secondLastDigit, el => el.textContent),
                page.$eval(CONFIG.SELECTORS.lastDigit, el => el.textContent)
            ]);

            const seconds = parseInt(secondLastDigit + lastDigit);

            // Kiểm tra tính hợp lệ của thời gian
            if (isNaN(seconds) || seconds < 0 || seconds > 180) {
                throw new Error(`Thời gian không hợp lệ: ${seconds}`);
            }

            // Log thời gian nếu có thay đổi
            if (seconds !== lastSeconds) {
                console.log("⏳ Còn lại:", seconds, "giây");
                lastSeconds = seconds;
                errorCount = 0; // Reset error count on successful update
            }

            // Reset trạng thái khi bắt đầu kỳ mới
            if (lastSeconds === 0 && seconds > 30) {
                console.log("🔄 Kỳ mới bắt đầu!");
                hasPredicted = false;
                errorCount = 0;
            }

            // Thực hiện dự đoán trong khoảng thời gian phù hợp
            if (seconds >= 15 && seconds <= 28 && !isPredicting && !hasPredicted) {
                console.log("🎯 Bắt đầu dự đoán...");
                isPredicting = true;
                hasPredicted = true;

                try {
                    await predictFunction();
                } catch (error) {
                    console.error("❌ Lỗi dự đoán:", error.message);
                    errorCount++;
                } finally {
                    isPredicting = false;
                }
            }

            // Reset dự đoán khi gần kết thúc
            if (seconds <= 1) {
                hasPredicted = false;
            }

        } catch (error) {
            console.error("⚠️ Lỗi đọc countdown:", error.message);
            errorCount++;

            // Nếu có quá nhiều lỗi liên tiếp, thử reload page
            if (errorCount >= MAX_ERRORS) {
                console.log("🔄 Đang thử reload page do có nhiều lỗi...");
                try {
                    await page.reload({ waitUntil: 'networkidle2' });
                    errorCount = 0;
                } catch (reloadError) {
                    console.error("❌ Không thể reload page:", reloadError.message);
                }
            }
        }
    }, 1000);

    return intervalId;
}

module.exports = {
    launchBrowser,
    openBettingPage,
    getCountDownTime
}; 