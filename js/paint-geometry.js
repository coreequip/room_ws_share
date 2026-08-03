export function computeVideoContentRect(video, container) {
  const { videoWidth, videoHeight } = video;
  const { width, height } = container;
  if (!videoWidth || !videoHeight || !width || !height) {
    return { x: 0, y: 0, width, height };
  }
  const videoRatio = videoWidth / videoHeight;
  const containerRatio = width / height;
  if (videoRatio > containerRatio) {
    const displayHeight = width / videoRatio;
    return { x: 0, y: (height - displayHeight) / 2, width, height: displayHeight };
  }
  if (videoRatio < containerRatio) {
    const displayWidth = height * videoRatio;
    return { x: (width - displayWidth) / 2, y: 0, width: displayWidth, height };
  }
  return { x: 0, y: 0, width, height };
}

export function pointToNormalized(pointerX, pointerY, contentRect) {
  return {
    x: clamp01((pointerX - contentRect.x) / contentRect.width),
    y: clamp01((pointerY - contentRect.y) / contentRect.height),
  };
}

export function normalizedToPoint(normalizedX, normalizedY, contentRect) {
  return {
    x: contentRect.x + normalizedX * contentRect.width,
    y: contentRect.y + normalizedY * contentRect.height,
  };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
