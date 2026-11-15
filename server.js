const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const LOGS_FILE = path.join(__dirname, 'logs.json');

// Khởi tạo file logs.json an toàn nếu chưa tồn tại hoặc bị rỗng
function ensureLogsFile() {
  try {
    if (!fs.existsSync(LOGS_FILE)) {
      fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2), 'utf8');
      console.log('Đã tự động khởi tạo file logs.json mới.');
    } else {
      const content = fs.readFileSync(LOGS_FILE, 'utf8').trim();
      if (!content) {
        fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2), 'utf8');
      }
    }
  } catch (err) {
    console.error('Lỗi khởi tạo logs.json:', err);
  }
}

// Chạy khởi tạo ngay khi server nạp
ensureLogsFile();

app.use(cors());
app.use(express.json());

// Serve static thư mục giao diện public
app.use(express.static(path.join(__dirname, 'public')));

// Serve mô hình AI từ cả my_model và my model để đảm bảo tương thích mọi URL
app.use('/my_model', express.static(path.join(__dirname, 'my_model')));
app.use('/my%20model', express.static(path.join(__dirname, 'my model')));
app.use('/my model', express.static(path.join(__dirname, 'my model')));

// Helper đọc logs an toàn
function readLogs() {
  try {
    ensureLogsFile();
    const data = fs.readFileSync(LOGS_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Lỗi đọc logs:', err);
    try {
      fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2), 'utf8');
    } catch (_) {}
    return [];
  }
}

// Helper ghi logs
function writeLogs(logs) {
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Lỗi ghi logs:', err);
    return false;
  }
}

// API: Lấy danh sách logs
app.get('/api/alert-logs', (req, res) => {
  const logs = readLogs();
  // Trả về danh sách xếp theo thứ tự mới nhất trước
  res.json({ success: true, count: logs.length, logs });
});

// API: Thêm log cảnh báo mới
app.post('/api/alert-logs', (req, res) => {
  const { level, duration, confidence, note, timestamp } = req.body;
  
  const now = new Date();
  const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const defaultDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

  const newLog = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
    timestamp: timestamp || `${defaultTime} ${defaultDate}`,
    level: level || 'Mức 2',
    duration: typeof duration === 'number' ? `${duration.toFixed(1)}s` : (duration || 'N/A'),
    confidence: typeof confidence === 'number' ? `${(confidence * 100).toFixed(1)}%` : (confidence || 'N/A'),
    note: note || 'Cảnh báo buồn ngủ'
  };

  const logs = readLogs();
  logs.unshift(newLog); // Thêm lên đầu danh sách

  // Giữ tối đa 100 log gần nhất
  if (logs.length > 100) {
    logs.length = 100;
  }

  writeLogs(logs);
  console.log(`[ALERT LOG] Đã lưu cảnh báo: ${newLog.level} | Tin cậy: ${newLog.confidence} | Thời lượng: ${newLog.duration}`);
  res.status(201).json({ success: true, log: newLog });
});

// API: Xóa toàn bộ logs
app.delete('/api/alert-logs', (req, res) => {
  writeLogs([]);
  res.json({ success: true, message: 'Đã xóa toàn bộ nhật ký cảnh báo' });
});

// Chạy server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  HỆ THỐNG NHẬN DIỆN BUỒN NGỦ VÀ CẢNH BÁO THỜI GIAN THỰC`);
  console.log(`  Máy chủ đang chạy tại: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
