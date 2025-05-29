const Lottery = require('../models/Lottery');

/**
 * Lưu dữ liệu xổ số vào database
 * @param {Array} lotteryData - Mảng chứa dữ liệu xổ số
 */
async function saveNumbers(lotteryData) {
    // Đảo ngược để xử lý từ kết quả cũ đến mới nhất
    lotteryData.reverse();

    for (const item of lotteryData) {
        try {
            // Kiểm tra sự tồn tại dựa trên drawId
            const exists = await Lottery.findOne({ drawId: item.drawId });

            if (!exists) {
                // Tạo bản ghi mới với đầy đủ thông tin
                const lotteryRecord = new Lottery({
                    drawId: item.drawId,
                    numbers: item.numbers,
                    drawTime: item.drawTime
                });
                await lotteryRecord.save();
                console.log('Đã lưu kỳ:', item.drawId);
            }
        } catch (err) {
            console.error('Lỗi khi lưu vào DB:', err);
        }
    }
}

/**
 * Lấy tất cả dữ liệu xổ số, sắp xếp theo thời gian tạo mới nhất
 * @param {number} page - Số trang (mặc định: 1)
 * @param {number} limit - Số lượng bản ghi mỗi trang (mặc định: 50)
 * @returns {Promise<Object>} Object chứa dữ liệu xổ số và thông tin phân trang
 */
async function getAllLotteryData(page = 1, limit = 50) {
    try {
        const skip = (page - 1) * limit;
        const total = await Lottery.countDocuments();
        
        const data = await Lottery.find()
            .sort({ drawTime: -1 })
            .skip(skip)
            .limit(limit);

        return {
            data,
            pagination: {
                currentPage: page,
                itemsPerPage: limit,
                totalPages: Math.ceil(total / limit),
                totalRecords: total,
                startIndex: skip + 1,
                endIndex: Math.min(skip + limit, total),
                hasMore: skip + data.length < total
            },
            debug: {
                skip,
                actualRecords: data.length,
                explanation: `Đang hiển thị các bản ghi từ ${skip + 1} đến ${Math.min(skip + limit, total)} trong tổng số ${total} bản ghi`
            }
        };
    } catch (err) {
        console.error('Lỗi khi lấy dữ liệu từ DB:', err);
        throw err;
    }
}

/**
 * Lấy dữ liệu xổ số theo drawId
 * @param {string} drawId - Mã kỳ xổ số
 * @returns {Promise<Object>} Dữ liệu xổ số của kỳ cụ thể
 */
async function getLotteryByDrawId(drawId) {
    try {
        const data = await Lottery.findOne({ drawId });
        return data;
    } catch (err) {
        console.error('Lỗi khi lấy dữ liệu theo drawId:', err);
        throw err;
    }
}

/**
 * Lấy dữ liệu xổ số trong khoảng thời gian
 * @param {string} startDate - Ngày bắt đầu (format: YYYY-MM-DD)
 * @param {string} endDate - Ngày kết thúc (format: YYYY-MM-DD)
 * @param {number} page - Số trang (mặc định: 1)
 * @param {number} limit - Số lượng bản ghi mỗi trang (mặc định: 50)
 * @returns {Promise<Object>} Object chứa dữ liệu xổ số và thông tin phân trang
 */
async function getLotteryByDateRange(startDate, endDate, page = 1, limit = 50) {
    try {
        const skip = (page - 1) * limit;
        const query = {
            drawTime: {
                $gte: startDate,
                $lte: endDate
            }
        };

        const total = await Lottery.countDocuments(query);
        
        const data = await Lottery.find(query)
            .sort({ drawTime: -1 })
            .skip(skip)
            .limit(limit);

        return {
            data,
            pagination: {
                currentPage: page,
                itemsPerPage: limit,
                totalPages: Math.ceil(total / limit),
                totalRecords: total,
                startIndex: skip + 1,
                endIndex: Math.min(skip + limit, total),
                hasMore: skip + data.length < total
            },
            debug: {
                skip,
                actualRecords: data.length,
                explanation: `Đang hiển thị các bản ghi từ ${skip + 1} đến ${Math.min(skip + limit, total)} trong tổng số ${total} bản ghi`
            }
        };
    } catch (err) {
        console.error('Lỗi khi lấy dữ liệu theo khoảng thời gian:', err);
        throw err;
    }
}

/**
 * Xóa dữ liệu cũ hơn X ngày
 * @param {number} days - Số ngày muốn giữ lại dữ liệu
 */
async function cleanupOldData(days = 365) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const result = await Lottery.deleteMany({
            createdAt: { $lt: cutoffDate }
        });

        console.log(`Đã xóa ${result.deletedCount} bản ghi cũ hơn ${days} ngày`);
    } catch (err) {
        console.error('Lỗi khi xóa dữ liệu cũ:', err);
        throw err;
    }
}

module.exports = {
    saveNumbers,
    getAllLotteryData,
    getLotteryByDrawId,
    getLotteryByDateRange,
    cleanupOldData
}; 