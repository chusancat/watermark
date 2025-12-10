require('dotenv').config();
const { S3Client, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const run = async () => {
    const params = {
        Bucket: process.env.R2_BUCKET_NAME,
        CORSConfiguration: {
            CORSRules: [
                {
                    // 允许的请求来源，开发阶段可以用 "*" 允许所有
                    AllowedOrigins: ["*"],
                    // 允许的动作，这里必须包含 PUT (用于上传) 和 GET (用于预览)
                    AllowedMethods: ["PUT", "POST", "GET", "HEAD", "DELETE"],
                    // 允许的头信息，必须包含 "*" 以允许 aws-sdk 发送的签名头
                    AllowedHeaders: ["*"],
                    // 允许前端获取的响应头
                    ExposeHeaders: ["ETag"],
                    // 缓存预检请求的时间（秒）
                    MaxAgeSeconds: 3000
                }
            ]
        }
    };

    try {
        const command = new PutBucketCorsCommand(params);
        await r2.send(command);
        console.log("✅ CORS 配置成功！现在浏览器可以直接上传文件到 R2 了。");
    } catch (err) {
        console.error("❌ 配置失败:", err);
    }
};

run();