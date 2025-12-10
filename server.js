require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const AWS = require('aws-sdk');

const app = express();
app.use(cors());
app.use(express.json());

// --- 🔐 新增：简单的密码验证中间件 ---
const authMiddleware = (req, res, next) => {
    // 默认账号 admin，密码从环境变量获取，如果没有设置则默认 123456
    const ADMIN_USER = 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || '123456';

    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    // 验证成功，放行
    if (login === ADMIN_USER && password === ADMIN_PASS) {
        return next();
    }

    // 验证失败，返回 401 状态码，浏览器会自动弹出登录框
    res.set('WWW-Authenticate', 'Basic realm="401"');
    res.status(401).send('请先登录 / Authentication required');
};

// 静态文件托管 (公开)
app.use(express.static(path.join(__dirname, 'public')));

// 首页路由 (公开)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 🔒 后台页面路由 (需要密码)
app.get('/admin', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- 配置 Cloudflare R2 ---
const s3 = new AWS.S3({
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    signatureVersion: 'v4',
    region: 'auto'
});
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

// API: 获取上传链接 (公开，供前端拍照上传)
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
            Bucket: BUCKET_NAME, Key: objectKey, Expires: 60,
            ContentType: fileType, Metadata: metaDataConfig
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

// 🔒 API: 获取列表 (需要密码，防止别人直接调接口偷看数据)
app.get('/api/list-photos', authMiddleware, async (req, res) => {
    try {
        const data = await s3.listObjectsV2({ Bucket: BUCKET_NAME, Prefix: 'photos/' }).promise();
        if (!data.Contents) return res.json([]);
        const files = await Promise.all(data.Contents.map(async (item) => {
            try {
                const head = await s3.headObject({ Bucket: BUCKET_NAME, Key: item.Key }).promise();
                const downloadUrl = await s3.getSignedUrlPromise('getObject', {
                    Bucket: BUCKET_NAME, Key: item.Key, Expires: 3600
                });
                return {
                    key: item.Key, size: item.Size, lastModified: item.LastModified,
                    metadata: head.Metadata, url: downloadUrl
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
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
module.exports = app;