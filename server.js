require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk'); // 使用旧版 SDK
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- 配置 Cloudflare R2 (AWS SDK v2) ---
const s3 = new AWS.S3({
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    signatureVersion: 'v4', // 必须强制使用 v4 签名
    region: 'auto'
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;

// 1. 获取上传预签名 URL
app.post('/api/get-upload-url', async (req, res) => {
    try {
        const { filename, fileType, metadata } = req.body;
        const objectKey = `photos/${Date.now()}_${filename}`;

        // 准备元数据 (统一编码，防止中文导致签名错误)
        const metaDataConfig = {
            'upload-time': new Date().toISOString(),
            'location-name': encodeURIComponent(metadata.locationName || 'Unknown'),
            'geo-lat': String(metadata.lat),
            'geo-lon': String(metadata.lon),
            'img-group': encodeURIComponent(metadata.group || 'default')
        };

        const params = {
            Bucket: BUCKET_NAME,
            Key: objectKey,
            Expires: 60,
            ContentType: fileType,
            Metadata: metaDataConfig
        };

        // 生成签名 URL
        const uploadURL = await s3.getSignedUrlPromise('putObject', params);

        // 关键修复：显式构建前端需要的 Headers
        // SDK v2 不会自动返回 header 对象，我们需要手动构造给前端
        const requiredHeaders = {
            'Content-Type': fileType,
            'x-amz-meta-upload-time': metaDataConfig['upload-time'],
            'x-amz-meta-location-name': metaDataConfig['location-name'],
            'x-amz-meta-geo-lat': metaDataConfig['geo-lat'],
            'x-amz-meta-geo-lon': metaDataConfig['geo-lon'],
            'x-amz-meta-img-group': metaDataConfig['img-group'],
        };

        res.json({ uploadURL, key: objectKey, headers: requiredHeaders });

    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: '无法生成上传链接' });
    }
});

// 2. 获取所有照片列表
app.get('/api/list-photos', async (req, res) => {
    try {
        const data = await s3.listObjectsV2({
            Bucket: BUCKET_NAME,
            Prefix: 'photos/'
        }).promise();

        if (!data.Contents) return res.json([]);

        // 获取文件详情
        const files = await Promise.all(data.Contents.map(async (item) => {
            try {
                // 在 v2 中 headObject 也是异步的
                const head = await s3.headObject({ Bucket: BUCKET_NAME, Key: item.Key }).promise();

                // 生成下载链接
                const downloadUrl = await s3.getSignedUrlPromise('getObject', {
                    Bucket: BUCKET_NAME,
                    Key: item.Key,
                    Expires: 3600
                });

                return {
                    key: item.Key,
                    size: item.Size,
                    lastModified: item.LastModified,
                    metadata: head.Metadata,
                    url: downloadUrl
                };
            } catch (e) { return null; }
        }));

        res.json(files.filter(f => f !== null));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: '无法获取列表' });
    }
});

const PORT = process.env.PORT || 3000;

// 修改点：为了适应 Vercel，只有在本地运行时才启动监听
// 如果是 Vercel 环境，它会自动处理，不需要我们在代码里 listen
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

// 必须导出 app，让 Vercel 接管
module.exports = app;