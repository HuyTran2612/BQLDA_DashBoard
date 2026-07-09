const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================
// 1. CƠ SỞ DỮ LIỆU GIẢ LẬP ĐỒNG BỘ 2 PHÂN HỆ
// =========================================================

// Phân hệ thi công (WBS & Nhật ký hiện trường)
let wbsData = [
    { id: "1", text: "Dự án Cầu vượt nút giao X", parentId: null, type: "project" },
    { id: "1.1", text: "Gói thầu số 05: Thi công xây dựng cầu", parentId: "1", type: "package" },
    { id: "1.1.1", text: "Hạng mục: Kết cấu phần hạ trụ", parentId: "1.1", type: "category" },
    { id: "1.1.1.1", text: "Khoan cọc nhồi trụ T1", parentId: "1.1.1", type: "task" },
    { id: "1.1.1.2", text: "Đổ bê tông bệ trụ T1", parentId: "1.1.1", type: "task" }
];

let tasks = [
    { id: "1.1.1.1", text: "Khoan cọc nhồi trụ T1", targetVolume: 100, unit: "mét cọc", pricePerUnit: 2 }, // Giả định 2 Tỷ/mét cọc để quy đổi tiền
    { id: "1.1.1.2", text: "Đổ bê tông bệ trụ T1", targetVolume: 500, unit: "m3", pricePerUnit: 0.5 } // Giả định 0.5 Tỷ/m3 bệ trụ
];

let progressLogs = [
    { id: 1, taskId: "1.1.1.1", date: "2026-07-05", volume: 30, note: "Đợt 1 ca ngày", image: "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=400", status: "Đã nghiệm thu" }
];

// Phân hệ giải ngân tài chính (Hợp đồng & Đề nghị thanh toán)
let contracts = [
    { id: "HD-05", name: "Hợp đồng gói 05: Kết cấu hạ trụ - Nhà thầu A", totalValue: 500, advancePercent: 20, retentionPercent: 5 }
];

let disbursementLogs = [
    { id: 1, contractId: "HD-05", period: "Thanh toán đợt 1 (Tạm ứng)", requestedAmount: 100, actualPay: 100, status: "Đã giải ngân", date: "2026-07-01", warning: false }
];

// =========================================================
// 2. HỆ THỐNG APIs TIẾN ĐỘ THI CÔNG
// =========================================================
app.get('/api/wbs', (req, res) => res.json(wbsData));
app.get('/api/tasks', (req, res) => res.json(tasks));

app.post('/api/wbs', (req, res) => {
    const newNode = req.body;
    wbsData.push(newNode);
    if (newNode.type === 'task') {
        tasks.push({
            id: newNode.id,
            text: newNode.text,
            targetVolume: 100,
            unit: "Đơn vị",
            pricePerUnit: 1 // Đơn giá mặc định là 1 Tỷ/đơn vị
        });
    }
    res.status(201).json({ success: true, data: newNode });
});

app.get('/api/progress-logs', (req, res) => {
    res.json(progressLogs.map(l => {
        const t = tasks.find(task => task.id === l.taskId);
        return { ...l, taskText: t ? t.text : "Hạng mục ẩn", unit: t ? t.unit : "" };
    }));
});

app.post('/api/progress-logs', (req, res) => {
    const { taskId, date, volume, note, imageUrl } = req.body;
    const newLog = { 
        id: progressLogs.length + 1, 
        taskId, 
        date, 
        volume: parseFloat(volume), 
        note, 
        image: imageUrl || "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=400", 
        status: "Chờ duyệt" 
    };
    progressLogs.unshift(newLog);
    res.status(201).json({ success: true });
});

app.post('/api/progress-logs/approve', (req, res) => {
    const { logId, status } = req.body;
    const log = progressLogs.find(l => l.id === parseInt(logId));
    if (log) log.status = status;
    res.json({ success: true });
});

app.get('/api/report/progress', (req, res) => {
    res.json(tasks.map(t => {
        const approvedVolume = progressLogs.filter(l => l.taskId === t.id && l.status === "Đã nghiệm thu").reduce((sum, l) => sum + l.volume, 0);
        return { id: t.id, text: t.text, targetVolume: t.targetVolume, approvedVolume, unit: t.unit, percent: parseFloat(((approvedVolume / t.targetVolume) * 100).toFixed(1)) };
    }));
});

// =========================================================
// 3. HỆ THỐNG APIs TIẾN ĐỘ GIẢI NGÂN
// =========================================================
app.get('/api/contracts', (req, res) => res.json(contracts));
app.post('/api/contracts', (req, res) => { contracts.push(req.body); res.status(201).json({ success: true }); });

app.get('/api/disbursements', (req, res) => {
    res.json(disbursementLogs.map(l => {
        const c = contracts.find(con => con.id === l.contractId);
        return { ...l, contractName: c ? c.name : "" };
    }));
});

// THUẬT TOÁN TỰ ĐỘNG BẮT LỖI LỆCH PHA TÀI CHÍNH VS HIỆN TRƯỜNG
app.post('/api/disbursements', (req, res) => {
    const { contractId, period, requestedAmount, date } = req.body;
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) return res.status(404).json({ success: false });

    const amount = parseFloat(requestedAmount);
    const actualPay = amount - (amount * (contract.advancePercent / 100)) - (amount * (contract.retentionPercent / 100));

    // Tính toán: Tổng giá trị thi công thực tế đã nghiệm thu ngoài hiện trường (Khối lượng thực tế * Đơn giá quy đổi)
    const totalApprovedConstructionValue = tasks.reduce((sum, t) => {
        const approvedVol = progressLogs.filter(l => l.taskId === t.id && l.status === "Đã nghiệm thu").reduce((s, l) => s + l.volume, 0);
        return sum + (approvedVol * (t.pricePerUnit || 0));
    }, 0);

    // Tổng số tiền nhà thầu đã xin thanh toán (bao gồm cả đợt này) từ trước tới nay
    const totalRequestedSoFar = disbursementLogs.filter(l => l.contractId === contractId && l.status !== "Bị từ chối").reduce((sum, l) => sum + l.requestedAmount, 0) + amount;

    // Nếu xin tiền > giá trị nghiệm thu thực tế + 100 Tỷ biên độ tạm ứng ban đầu -> Bật cờ cảnh báo lệch pha
    const isWarning = totalRequestedSoFar > (totalApprovedConstructionValue + 100); 

    const newBill = {
        id: disbursementLogs.length + 1,
        contractId,
        period,
        requestedAmount: amount,
        actualPay: parseFloat(actualPay.toFixed(2)),
        status: "Chờ kế toán duyệt",
        date: date || new Date().toISOString().split('T')[0],
        warning: isWarning
    };
    disbursementLogs.unshift(newBill);
    res.status(201).json({ success: true, data: newBill });
});

app.post('/api/disbursements/approve', (req, res) => {
    const { logId, action } = req.body;
    const log = disbursementLogs.find(l => l.id === parseInt(logId));
    if (log) {
        if (action === 'ke_toan_duyet') log.status = 'Chờ Giám đốc duyệt';
        else if (action === 'giam_doc_duyet') log.status = 'Đã giải ngân';
        else if (action === 'tu_choi') log.status = 'Bị từ chối';
        return res.json({ success: true });
    }
    res.status(404).json({ success: false });
});

app.get('/api/report/disbursement', (req, res) => {
    res.json(contracts.map(c => {
        const totalPaid = disbursementLogs.filter(l => l.contractId === c.id && l.status === "Đã giải ngân").reduce((sum, l) => sum + l.actualPay, 0);
        return { id: c.id, name: c.name, totalValue: c.totalValue, totalPaid: parseFloat(totalPaid.toFixed(2)), rate: parseFloat((c.totalValue > 0 ? (totalPaid / c.totalValue) * 100 : 0).toFixed(1)) };
    }));
});

// =========================================================
// 4. API TRANG CHỦ TỔNG QUAN (INDEX) ĐỒNG BỘ THẬT 100%
// =========================================================
app.get('/api/dashboard/summary', (req, res) => {
    // 1. Tính tiến độ thi công trung bình
    const approvedTasks = tasks.map(t => {
        const approvedVolume = progressLogs.filter(l => l.taskId === t.id && l.status === "Đã nghiệm thu").reduce((sum, l) => sum + l.volume, 0);
        const percent = (approvedVolume / t.targetVolume) * 100;
        return percent > 100 ? 100 : percent;
    });
    const totalPercent = approvedTasks.reduce((sum, p) => sum + p, 0);
    const avgProgress = approvedTasks.length > 0 ? (totalPercent / approvedTasks.length).toFixed(0) : 0;

    // 2. Tính toán số liệu giải ngân thực tế từ lịch sử chứng từ đã duyệt chi thành công
    const totalBudget = contracts.reduce((sum, c) => sum + c.totalValue, 0);
    const disbursed = disbursementLogs.filter(l => l.status === "Đã giải ngân").reduce((sum, l) => sum + l.actualPay, 0);
    const disbursePercent = totalBudget > 0 ? ((disbursed / totalBudget) * 100).toFixed(0) : 0;

    res.json({
        totalBudget,
        disbursed: parseFloat(disbursed.toFixed(1)),
        disbursePercent,
        avgProgress
    });
});

app.listen(PORT, () => console.log(`=== Hệ thống QLDA hoàn chỉnh đang chạy tại: http://localhost:${PORT} ===`));