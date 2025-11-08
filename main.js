// main.js
// 作用：通过 MQTT over WebSocket 订阅 topic 'senior'（QoS 0），解析接收到的 JSON 数据，并更新页面与图表。

// 可修改的配置
// 注意：很多 MQTT Broker（例如 EMQX、Mosquitto）在不同端口提供 WebSocket 支持。
// 端口 18083 通常是 EMQX 的管理控制台（HTTP），不是 MQTT over WebSocket 的端口，
// 如果你之前使用 ws://192.168.240.214:18083/mqtt 连接失败，很可能是端口或 path 错误。
// 下面会按顺序尝试常见的 WebSocket 端口，如果你知道正确的端口/路径可以直接修改 firstSuccessfulUrl 或 ports。
const BROKER_HOST = '192.168.240.214';
const BROKER_PATH = '/mqtt'; // 常见有 '/mqtt'、'/ws'，或直接空路径
// 如果 Broker 需要用户名/密码，将它们放在下面（你提供的凭据会被用来连接）
const MQTT_USERNAME = 'yph';
const MQTT_PASSWORD = 'yph';
const BROKER_PORTS = [8083, 9001, 80, 443, 18083]; // 按优先级尝试
const TOPIC = 'senior';
const QOS = 0;

let client = null;
let environmentChart = null;
let currentBrokerUrl = null;

// 页面初始化：创建 Chart.js 图表并连接 MQTT
document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    connectMqtt();
    // 页面导航（保留简洁切页逻辑）
    const navLinks = document.querySelectorAll('.nav-link');
    const pages = document.querySelectorAll('.page');
    navLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            navLinks.forEach(l => l.classList.remove('active'));
            pages.forEach(p => p.classList.remove('active'));
            this.classList.add('active');
            const pageId = this.getAttribute('data-page');
            document.getElementById(pageId).classList.add('active');
        });
    });
});

function initCharts() {
    // 环境趋势图：两个数据集（空气温度、土壤湿度）
    const envCtx = document.getElementById('environmentChart').getContext('2d');
    environmentChart = new Chart(envCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: '空气温度 (°C)',
                    data: [],
                    borderColor: '#ff6384',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    tension: 0.3,
                    fill: true
                },
                {
                    label: '土壤湿度 (%)',
                    data: [],
                    borderColor: '#36a2eb',
                    backgroundColor: 'rgba(54, 162, 235, 0.08)',
                    tension: 0.3,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: {
                y: { beginAtZero: false }
            }
        }
    });
}

function connectMqtt() {
    // 顺序尝试常见的 WebSocket 端口与 path
    const tried = [];
    const tryPorts = [...BROKER_PORTS];

    function attemptNext() {
        if (tryPorts.length === 0) {
            console.error('所有候选 WebSocket URL 均尝试失败:', tried);
            // 在页面上给出提示
            const el = document.getElementById('lastUpdateTime');
            if (el) el.textContent = '连接失败：请检查 Broker 的 WebSocket 端口/路径（浏览器控制台查看详情）';
            return;
        }

        const port = tryPorts.shift();
        // 支持空路径
        const path = BROKER_PATH ? BROKER_PATH : '';
        const url = `ws://${BROKER_HOST}:${port}${path}`;
        tried.push(url);
        console.log('尝试连接 MQTT Broker：', url);

        // 为了快速判断是否可连接，使用较短的 connectTimeout 并禁用自动重连（reconnectPeriod: 0）
        const tempClient = mqtt.connect(url, {
            clientId: 'web_try_' + Math.random().toString(16).substr(2, 8),
            keepalive: 20,
            reconnectPeriod: 0,
            connectTimeout: 5000,
            username: MQTT_USERNAME,
            password: MQTT_PASSWORD
        });

        let settled = false;

        function cleanup() {
            tempClient.removeAllListeners('connect');
            tempClient.removeAllListeners('error');
            tempClient.removeAllListeners('close');
        }

        tempClient.on('connect', () => {
            if (settled) return;
            settled = true;
            cleanup();
            console.log('尝试成功，使用 URL：', url);
            // 正式使用此 client，并启用自动重连
            if (client && client.end) client.end(true);
            currentBrokerUrl = url;
            client = mqtt.connect(url, {
                clientId: 'web_' + Math.random().toString(16).substr(2, 8),
                keepalive: 30,
                reconnectPeriod: 4000,
                connectTimeout: 30 * 1000,
                username: MQTT_USERNAME,
                password: MQTT_PASSWORD
            });

            client.on('connect', () => {
                console.log('MQTT 已连接 ->', currentBrokerUrl);
                client.subscribe(TOPIC, { qos: QOS }, (err) => {
                    if (err) console.error('订阅失败:', err);
                    else console.log('已订阅 topic:', TOPIC);
                });
            });

            client.on('reconnect', () => console.log('MQTT 重新连接...'));
            client.on('error', (err) => console.error('MQTT 错误:', err));
            client.on('offline', () => console.warn('MQTT 离线'));

            client.on('message', (topic, payload) => {
                try {
                    const text = payload.toString();
                    console.log('收到消息', topic, text);
                    const data = JSON.parse(text);
                    handleData(data);
                } catch (e) {
                    console.error('消息解析错误', e);
                }
            });
        });

        tempClient.on('error', (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            try { tempClient.end(true); } catch (e) { }
            console.warn('尝试连接失败：', url, err && err.message ? err.message : err);
            // 继续尝试下一个端口
            setTimeout(attemptNext, 200);
        });

        tempClient.on('close', () => {
            if (settled) return;
            settled = true;
            cleanup();
            try { tempClient.end(true); } catch (e) { }
            console.warn('连接已关闭，尝试下一个候选');
            setTimeout(attemptNext, 200);
        });
    }

    attemptNext();
}

// 解析并更新页面；data 示例：
// {"pest": "Normal", "air_humi": 25, "light_intensity": 1828.0, "soil_moisture": 0.0, "air_temp": 25, "light_level": "Weak", "co2_ppm": 800}
function handleData(d) {
    // 容错：只处理对象
    if (!d || typeof d !== 'object') return;

    // 映射字段并更新 DOM（如果存在对应元素）
    // 基本字段（更新首页和监测页对应的元素）
    setTextIfExists('airTemp', d.air_temp);
    setTextIfExists('airTempMonitor', d.air_temp);

    setTextIfExists('soilMoisture', d.soil_moisture);
    setTextIfExists('soilMoistureMonitor', d.soil_moisture);

    setTextIfExists('airHumi', d.air_humi);
    setTextIfExists('airHumiMonitor', d.air_humi);

    setTextIfExists('lightIntensity', d.light_intensity);
    setTextIfExists('co2', d.co2_ppm);
    setTextIfExists('treeTilt', d.tree_diameter_mm);

    // 额外标签
    // soil_level（例如: Dry/湿润 等）或 soilLevel 字段
    // 状态字段
    setTextIfExists('soilLevel', d.soil_level);
    setTextIfExists('soilLevelMonitor', d.soil_level);
    setTextIfExists('soilLevelLabel', d.soil_level);
    setTextIfExists('soilLevelLabelMonitor', d.soil_level);

    setTextIfExists('lightLevel', d.light_level);
    setTextIfExists('lightLevelMonitor', d.light_level);
    setTextIfExists('lightLevelDisplay', d.light_level);

    // pest / 病虫害
    if (d.pest !== undefined) {
        setTextIfExists('pestStatus', translatePest(d.pest));
        setTextIfExists('pest', translatePest(d.pest));
        setTextIfExists('treeState', translatePest(d.pest));
    }

    setTextIfExists('co2Label', categorizeCO2(d.co2_ppm));

    // KPI 区域（此处演示：健康评分/固碳/降温 等可由后端直接推送字段，若无可用占位）
    if (d.health_score !== undefined) {
        setTextIfExists('healthScore', d.health_score);
        setTextIfExists('healthScoreLarge', d.health_score);
    }
    if (d.carbon_value !== undefined) setTextIfExists('carbonValue', d.carbon_value);
    if (d.cooling_effect !== undefined) setTextIfExists('coolingEffect', d.cooling_effect);
    if (d.pest !== undefined) setTextIfExists('treeState', translatePest(d.pest));

    // 更新更新时间
    const now = new Date().toLocaleString('zh-CN');
    setTextIfExists('lastUpdateTime', now);

    // 更新图表（在 environmentChart 上追加点）
    try {
        const label = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        // 限制数据点数量以防无限增长
        const maxPoints = 50;
        if (environmentChart) {
            const t = environmentChart.data;
            t.labels.push(label);
            // 空值保护
            const at = (typeof d.air_temp === 'number') ? d.air_temp : null;
            const sm = (typeof d.soil_moisture === 'number') ? d.soil_moisture : null;
            t.datasets[0].data.push(at);
            t.datasets[1].data.push(sm);
            // 截断
            if (t.labels.length > maxPoints) {
                t.labels.shift();
                t.datasets.forEach(ds => ds.data.shift());
            }
            environmentChart.update();
        }
    } catch (e) {
        console.error('图表更新错误', e);
    }
}

function setTextIfExists(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    // 保留两位小数（若是数值）
    if (typeof value === 'number') {
        if (Number.isFinite(value)) el.textContent = (Math.round(value * 100) / 100).toString();
        else el.textContent = '--';
    } else if (value === null || value === undefined) {
        el.textContent = '--';
    } else {
        el.textContent = value;
    }
}

function translatePest(p) {
    // 简单映射：用户示例里有 Normal/其他
    if (!p) return '--';
    if (p === 'Normal' || p === '正常') return '正常';
    return p;
}

function categorizeCO2(ppm) {
    if (typeof ppm !== 'number') return '--';
    if (ppm < 600) return '良好';
    if (ppm < 1000) return '正常';
    return '偏高';
}

// 导出接口（方便调试）
window.__iot = { connectMqtt, handleData };
