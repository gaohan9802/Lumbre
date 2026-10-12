/** Keep phone photos useful while avoiding multi-megabyte browser uploads. */
export function compressImage(dataUrl: string, maxDim = 1568, quality = 0.85): Promise<string> {
  return new Promise(resolve => {
    try {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(dataUrl)
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    } catch { resolve(dataUrl) }
  })
}
