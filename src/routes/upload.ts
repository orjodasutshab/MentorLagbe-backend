import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { verifyToken } from '../middleware/auth.ts';
import { uploadRateLimiter } from '../middleware/rateLimit.ts';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');

function hasDangerousExtension(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  return /\.(svg|html|htm|js|mjs|cjs|ts|php|exe|sh|bat|cmd)$/i.test(lower);
}

function matchesImageSignature(buffer: Buffer, ext: string): boolean {
  if (ext === 'png') return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === 'jpg' || ext === 'jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (ext === 'gif') return buffer.length > 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (ext === 'webp') return buffer.length > 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

router.post('/', verifyToken, uploadRateLimiter, async (req, res, next) => {
  try {
    const { imageBase64, filename } = req.body as { imageBase64?: string; filename?: string };
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ error: 'No image data provided.' });
      return;
    }

    if (filename && typeof filename === 'string' && hasDangerousExtension(filename)) {
      res.status(400).json({ error: 'Executable, HTML, SVG, or script files are not allowed.' });
      return;
    }

    const match = imageBase64.match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i);
    if (!match) {
      res.status(400).json({ error: 'Unsupported image format. Please upload PNG, JPG, WEBP, or GIF.' });
      return;
    }

    const ext = match[2].toLowerCase() === 'jpeg' ? 'jpg' : match[2].toLowerCase();
    const rawBase64 = match[3];
    const buffer = Buffer.from(rawBase64, 'base64');

    if (buffer.length === 0) {
      res.status(400).json({ error: 'Uploaded image file is empty.' });
      return;
    }
    if (!matchesImageSignature(buffer, ext)) {
      res.status(400).json({ error: 'The file content does not match the declared image type.' });
      return;
    }
    if (buffer.length > 5 * 1024 * 1024) {
      res.status(400).json({ error: 'Image size must be under 5MB.' });
      return;
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const cloudKey = process.env.CLOUDINARY_API_KEY?.trim();
    const cloudSecret = process.env.CLOUDINARY_API_SECRET?.trim();
    if (cloudName && cloudKey && cloudSecret && !cloudName.startsWith('replace_with')) {
      // Signed upload straight to Cloudinary's REST API (no SDK needed).
      const folder = 'mentorlagbe';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = crypto
        .createHash('sha1')
        .update(`folder=${folder}&timestamp=${timestamp}${cloudSecret}`)
        .digest('hex');

      const form = new FormData();
      form.append('file', `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${rawBase64}`);
      form.append('api_key', cloudKey);
      form.append('timestamp', timestamp);
      form.append('folder', folder);
      form.append('signature', signature);

      const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
        method: 'POST',
        body: form,
      });
      const json = (await response.json()) as { secure_url?: string; error?: { message?: string } };
      if (response.ok && json.secure_url) {
        res.json({ url: json.secure_url, provider: 'cloudinary' });
        return;
      }
      throw new Error(json.error?.message || 'Cloudinary upload failed.');
    }

    const imgbbKey = process.env.IMGBB_API_KEY?.trim();
    if (imgbbKey && !imgbbKey.startsWith('replace_with')) {
      const form = new FormData();
      form.append('key', imgbbKey);
      form.append('image', rawBase64);
      if (filename) form.append('name', filename.replace(/[^a-zA-Z0-9._-]/g, '_'));

      const response = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: form,
      });
      const json = (await response.json()) as {
        success?: boolean;
        data?: { display_url?: string; url?: string };
        error?: { message?: string };
      };
      if (response.ok && json.success && (json.data?.display_url || json.data?.url)) {
        res.json({ url: json.data.display_url || json.data.url, provider: 'imgbb' });
        return;
      }
      throw new Error(json.error?.message || 'ImgBB upload failed.');
    }

    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({
        error: 'Image upload is not configured. Set IMGBB_API_KEY (or the CLOUDINARY_* variables) on the server.',
      });
      return;
    }

    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    const safeName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, safeName), buffer);

    res.json({
      url: `/api/uploads/${safeName}`,
      provider: 'local',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
