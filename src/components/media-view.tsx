import { Image } from 'expo-image';
import { LivePhotoView } from 'expo-live-photo';
import { useVideoPlayer, VideoView, type VideoThumbnail as ExpoVideoThumbnail } from 'expo-video';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { EntryImage, FollowUpImage } from '@/domain/journal';
import { ZoomableImage } from '@/components/zoomable-image';

export type JournalMedia = Pick<EntryImage | FollowUpImage, 'uri' | 'mediaType' | 'pairedVideoUri' | 'duration'>;

export function MediaThumbnail({ media, style }: { media: JournalMedia; style?: StyleProp<ViewStyle> }) {
  if (isVideo(media)) return <VideoThumbnail media={media} style={style} />;
  return <View style={[styles.mediaThumb, style]}><Image source={media.uri} contentFit="cover" style={StyleSheet.absoluteFill} />{media.mediaType === 'livePhoto' ? <Text style={styles.liveBadge}>LIVE</Text> : null}</View>;
}

export function MediaViewer({ media }: { media: JournalMedia }) {
  if (isVideo(media)) return <VideoPlayer uri={media.uri} />;
  if (media.mediaType === 'livePhoto' && media.pairedVideoUri && Platform.OS === 'ios' && LivePhotoView.isAvailable()) {
    return <View style={styles.full}>
      <LivePhotoView source={{ photoUri: media.uri, pairedVideoUri: media.pairedVideoUri }} contentFit="contain" style={styles.full} />
      <View pointerEvents="none" style={styles.liveHint}><Text style={styles.liveHintText}>长按播放实况</Text></View>
    </View>;
  }
  // Android does not implement Apple's Live Photo container. When a valid
  // paired motion clip exists, playing that clip is the closest useful fallback.
  if (media.mediaType === 'livePhoto' && media.pairedVideoUri) return <VideoPlayer uri={media.pairedVideoUri} />;
  return <ZoomableImage key={media.uri} uri={media.uri} />;
}

function isVideo(media: JournalMedia) {
  return media.mediaType === 'video'
    || Boolean(media.duration && media.duration > 0)
    || /\.(mp4|mov|m4v|webm)(?:$|\?)/i.test(media.uri);
}

function VideoThumbnail({ media, style }: { media: JournalMedia; style?: StyleProp<ViewStyle> }) {
  const player = useVideoPlayer(media.uri);
  const [thumbnail, setThumbnail] = useState<ExpoVideoThumbnail | null>(null);

  useEffect(() => {
    let active = true;
    void player.generateThumbnailsAsync(0.05, { maxWidth: 480, maxHeight: 480 })
      .then(([result]) => { if (active && result) setThumbnail(result); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [player]);

  return <View style={[styles.videoThumb, style]}>
    {thumbnail ? <Image source={thumbnail} contentFit="cover" style={StyleSheet.absoluteFill} /> : null}
    <View style={styles.playCircle}><Text style={styles.play}>▶</Text></View>
    {media.duration ? <Text style={styles.duration}>{formatDuration(media.duration)}</Text> : null}
  </View>;
}

function VideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });
  return <VideoView player={player} nativeControls contentFit="contain" style={styles.full} />;
}

function formatDuration(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  full: { width: '100%', height: '100%' },
  mediaThumb: { overflow: 'hidden' },
  videoThumb: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#25302C' },
  playCircle: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#00000080' },
  play: { marginLeft: 2, color: '#FFFFFF', fontSize: 16 },
  duration: { position: 'absolute', right: 5, bottom: 4, overflow: 'hidden', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, backgroundColor: '#00000099', color: '#FFFFFF', fontSize: 9 },
  liveBadge: { position: 'absolute', left: 5, top: 5, overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, backgroundColor: '#00000099', color: '#FFFFFF', fontSize: 7, fontWeight: '700' },
  liveHint: { position: 'absolute', left: 0, right: 0, bottom: 42, alignItems: 'center' },
  liveHintText: { overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: '#00000080', color: '#FFFFFF', fontSize: 11 },
});
