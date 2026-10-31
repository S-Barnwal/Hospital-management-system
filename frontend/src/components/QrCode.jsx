// QR code as inline SVG (uses the well-known "qrcode" package). The value is always an app URL we build.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function QrCode({ value, size = 96, className, label = 'QR code' }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toString(String(value), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(''));
    return () => { live = false; };
  }, [value]);
  // The SVG string is produced by the library from our own value (no user HTML), so injecting it is safe.
  return <span role="img" aria-label={label} className={className} style={{ display: 'inline-block', width: size, height: size }}
    dangerouslySetInnerHTML={{ __html: svg.replace('<svg', `<svg width="${size}" height="${size}"`) }} />;
}
