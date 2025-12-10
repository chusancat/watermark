require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path'); // 引入 path 模块
const AWS = require('aws-sdk'); // 假设你还在用 v2

const app = express();
app.use(cors());
app.use(express.json());

// 关键修正 1: 使用绝对路径托管静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 关键修正 2: 显式定义根路由，确保访问域名时返回 index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 关键修正 3: 显式定义后台路由
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- 配置 Cloudflare R2 (AWS SDK v2) ---
const s3 = new AWS.S3({
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    signatureVersion: 'v4',
    region: 'auto'
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;

// API: 获取上传链接
app.post('/api/get-upload-url', async (req, res) => {
    try {
        const { filename, fileType, metadata } = req.body;
        const objectKey = `photos/${Date.now()}_${filename}`;

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

        const uploadURL = await s3.getSignedUrlPromise('putObject', params);

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

// API: 获取列表
app.get('/api/list-photos', async (req, res) => {
    try {
        const data = await s3.listObjectsV2({
            Bucket: BUCKET_NAME,
            Prefix: 'photos/'
        }).promise();

        if (!data.Contents) return res.json([]);

        const files = await Promise.all(data.Contents.map(async (item) => {
            try {
                const head = await s3.headObject({ Bucket: BUCKET_NAME, Key: item.Key }).promise();
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

// Vercel 适配
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
module.exports = app;