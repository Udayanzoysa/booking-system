import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdir, open, realpath, rename, stat, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeAttachment } from './payhere';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const uuidPattern = new RegExp('^' + uuid + '$', 'i');
const storagePattern = new RegExp('^bookings/(' + uuid + ')/(' + uuid + ')\\.(jpg|png|pdf)$', 'i');
const maximumSize = 5 * 1024 * 1024;

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function storageRoot() {
  const configured = path.resolve(process.env.ATTACHMENTS_DIR?.trim() || path.join(process.cwd(), 'uploads'));
  await mkdir(configured, { recursive: true, mode: 0o700 });
  return realpath(configured);
}

export async function writeSlipAttachment(bookingId: string, slipId: string, file: { buffer: Buffer; mimetype: string; size: number }): Promise<string> {
  const mime = safeAttachment(file);
  if (!uuidPattern.test(bookingId) || !uuidPattern.test(slipId) || !mime || file.size !== file.buffer.length || file.size < 1 || file.size > maximumSize) {
    throw new BadRequestException('Attach a JPEG, PNG or PDF bank slip up to 5 MB');
  }
  const root = await storageRoot();
  const directory = path.join(root, 'bookings', bookingId.toLowerCase());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!isWithin(root, await realpath(directory))) throw new BadRequestException('Invalid attachment folder');
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'pdf';
  const storagePath = `bookings/${bookingId.toLowerCase()}/${slipId.toLowerCase()}.${extension}`;
  const target = path.join(root, ...storagePath.split('/'));
  const temporary = path.join(directory, '.' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(file.buffer);
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(temporary, target);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return storagePath;
}

async function privateAttachmentPath(storagePath: string) {
  if (!storagePattern.test(storagePath)) throw new NotFoundException('Attachment not found');
  const root = await storageRoot();
  try {
    const resolved = await realpath(path.join(root, ...storagePath.split('/')));
    if (!isWithin(root, resolved)) throw new Error();
    return resolved;
  } catch { throw new NotFoundException('Attachment not found'); }
}

export async function readSlipAttachment(storagePath: string, expectedSize: number): Promise<Buffer> {
  const target = await privateAttachmentPath(storagePath);
  const details = await stat(target);
  if (!details.isFile() || details.size !== expectedSize || details.size > maximumSize || details.size < 1) {
    throw new NotFoundException('Attachment not found');
  }
  return readFile(target);
}

export async function removeSlipAttachment(storagePath: string): Promise<void> {
  try { await unlink(await privateAttachmentPath(storagePath)); }
  catch (error) { if (!(error instanceof NotFoundException)) throw error; }
}
