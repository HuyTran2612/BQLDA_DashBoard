const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================
// 1. CẤU HÌNH HỆ THỐNG (DỮ LIỆU CÓ THỂ THAY ĐỔI DỰA TRÊN UI)
// =========================================================
let systemConfig = {
    totalProjectBudgetCap: 600,       // Hạn mức trần tổng vốn dự án (Tỷ VND)
    warningThresholdPercent: 90,     // Ngưỡng phát tín hiệu cảnh báo ngân sách (%)
    overBillingBuffer: 100           // Biên độ dung sai lệch pha tạm ứng đầu dự án (Tỷ VND)
};

// =========================================================
// CƠ SỞ DỮ LIỆU GIẢ LẬP ĐỒNG BỘ
// =========================================================
let wbsData = [
    { id: "1", text: "Dự án Cầu vượt nút giao X", parentId: null, type: "project" },
    { id: "1.1", text: "Gói thầu số 05: Thi công xây dựng cầu", parentId: "1", type: "package" },
    { id: "1.1.1", text: "Khoan cọc nhồi trụ T1", parentId: "1.1", type: "task" },
    { id: "1.1.2", text: "Đổ bê tông bệ trụ T1", parentId: "1.1", type: "task" }
];

let tasks = [
    { id: "1.1.1", text: "Khoan cọc nhồi trụ T1", targetVolume: 100, unit: "mét cọc", pricePerUnit: 2 }, 
    { id: "1.1.2", text: "Đổ bê tông bệ trụ T1", targetVolume: 500, unit: "m3", pricePerUnit: 0.5 }
];

let progressLogs = [
    { id: 1, taskId: "1.1.1", date: "2026-07-05", volume: 30, note: "Đợt 1 ca ngày", image: "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=400", status: "Đã nghiệm thu" }
];

let contracts = [
    { id: "HD-05", name: "Hợp đồng gói 05: Kết cấu hạ trụ - Nhà thầu A", totalValue: 500, advancePercent: 20, retentionPercent: 5 }
];

let disbursementLogs = [
    { id: 1, contractId: "HD-05", period: "Thanh toán đợt 1 (Tạm ứng)", requestedAmount: 120, actualPay: 120, status: "Đã giải ngân", date: "2026-07-01" }
];

// --- APIs TIẾN ĐỘ THI CÔNG & GIẢI NGÂN (Giữ nguyên luồng) ---
app.get('/api/wbs', (req, res) => res.json(wbsData));
app.get('/api/tasks', (req, res) => res.json(tasks));
app.get('/api/progress-logs', (req, res) => {
    res.json(progressLogs.map(l => ({ ...l, taskText: tasks.find(t=>t.id===l.taskId)?.text || "Ẩn", unit: tasks.find(t=>t.id===l.taskId)?.unit || "" })));
});
app.post('/api/progress-logs', (req, res) => {
    progressLogs.unshift({ id: progressLogs.length + 1, ...req.body, volume: parseFloat(req.body.volume), status: "Chờ duyệt" });
    res.status(201).json({ success: true });
});
app.post('/api/progress-logs/approve', (req, res) => {
    const log = progressLogs.find(l => l.id === parseInt(req.body.logId));
    if (log) log.status = req.body.status;
    res.json({ success: true });
});
app.get('/api/contracts', (req, res) => res.json(contracts));
app.post('/api/contracts', (req, res) => { contracts.push(req.body); res.status(201).json({ success: true }); });
app.get('/api/disbursements', (req, res) => {
    res.json(disbursementLogs.map(l => ({ ...l, contractName: contracts.find(c=>c.id===l.contractId)?.name || "" })));
});
app.post('/api/disbursements', (req, res) => {
    disbursementLogs.unshift({ id: disbursementLogs.length + 1, ...req.body, requestedAmount: parseFloat(req.body.requestedAmount), status: "Chờ kế toán duyệt" });
    res.status(201).json({ success: true });
});
app.post('/api/disbursements/approve', (req, res) => {
    const log = disbursementLogs.find(l => l.id === parseInt(req.body.logId));
    if (log) {
        if (req.body.action === 'ke_toan_duyet') log.status = 'Chờ Giám đốc duyệt';
        else if (req.body.action === 'giam_doc_duyet') log.status = 'Đã giải ngân';
        else if (req.body.action === 'tu_choi') log.status = 'Bị từ chối';
    }
    res.json({ success: true });
});

// =========================================================
// NEW CHỨC NĂNG: APIs ĐỌC / GHI CẤU HÌNH HỆ THỐNG
// =========================================================
app.get('/api/config', (req, res) => res.json(systemConfig));

app.post('/api/config', (req, res) => {
    const { totalProjectBudgetCap, warningThresholdPercent, overBillingBuffer } = req.body;
    systemConfig.totalProjectBudgetCap = parseFloat(totalProjectBudgetCap);
    systemConfig.warningThresholdPercent = parseFloat(warningThresholdPercent);
    systemConfig.overBillingBuffer = parseFloat(overBillingBuffer);
    res.json({ success: true, message: "Cấu hình hệ thống cập nhật thành công!" });
});

// CẬP NHẬT TRỤC RISK ENGINE ĐỂ SỬ DỤNG BIẾN ĐỘNG TỪ CẤU HÌNH LINH HOẠT
app.get('/api/risks', (req, res) => {
    let activeRisks = [];

    const totalApprovedConstructionValue = tasks.reduce((sum, t) => {
        const approvedVol = progressLogs.filter(l => l.taskId === t.id && l.status === "Đã nghiệm thu").reduce((s, l) => s + l.volume, 0);
        return sum + (approvedVol * t.pricePerUnit);
    }, 0);

    const totalContractValueCommitted = contracts.reduce((sum, c) => sum + c.totalValue, 0);
    
    // Thuật toán 1: Lấy thông số cảnh báo tổng mức đầu tư từ biến cấu hình linh hoạt
    if (totalContractValueCommitted > systemConfig.totalProjectBudgetCap) {
        activeRisks.push({
            type: "Kinh tế - Ngân sách",
            level: "CỰC KỲ NGUY HIỂM",
            title: "Vượt tổng mức chi phí phê duyệt dự án",
            desc: `Tổng giá trị hợp đồng ký kết (${totalContractValueCommitted} Tỷ) vượt quá hạn mức vốn tối đa vừa cấu hình (${systemConfig.totalProjectBudgetCap} Tỷ).`
        });
    } else if (totalContractValueCommitted > systemConfig.totalProjectBudgetCap * (systemConfig.warningThresholdPercent / 100)) {
        activeRisks.push({
            type: "Kinh tế - Ngân sách",
            level: "Cảnh báo cao",
            title: "Hạn mức ngân sách chạm ngưỡng dự phòng",
            desc: `Tổng giá trị hợp đồng đã ký đạt ${totalContractValueCommitted} Tỷ, chiếm trên ${systemConfig.warningThresholdPercent}% quỹ vốn cấu hình.`
        });
    }

    // Thuật toán 2: Lấy thông số biên độ dung sai (overBillingBuffer) từ biến cấu hình linh hoạt
    contracts.forEach(c => {
        const totalRequested = disbursementLogs
            .filter(l => l.contractId === c.id && l.status !== "Bị từ chối")
            .reduce((sum, l) => sum + l.requestedAmount, 0);
        
        const safetyThreshold = totalApprovedConstructionValue + (c.totalValue * (c.advancePercent / 100)) + systemConfig.overBillingBuffer;
        
        if (totalRequested > safetyThreshold) {
            activeRisks.push({
                type: "Tài chính giải ngân",
                level: "Cảnh báo cao",
                title: `Lệch pha dòng vốn tại hợp đồng ${c.id}`,
                desc: `Tổng số tiền đề nghị giải ngân (${totalRequested} Tỷ) vượt ngưỡng an toàn thực tế đã tính cả biên độ dung sai ${systemConfig.overBillingBuffer} Tỷ.`
            });
        }
    });

    res.json({
        projectCap: systemConfig.totalProjectBudgetCap,
        committed: totalContractValueCommitted,
        risks: activeRisks
    });
});

app.listen(PORT, () => console.log(`=== Hệ thống chạy ổn định, cấu hình tại cổng: http://localhost:${PORT} ===`));