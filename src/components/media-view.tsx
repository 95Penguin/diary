import { useEvent } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { EntryImage, FollowUpImage } from '@/domain/journal';
import { ZoomableImage } from '@/components/zoomable-image';

export type JournalMedia = Pick<EntryImage | FollowUpImage, 'uri' | 'mediaType' | 'pairedVideoUri' | 'duration' | 'thumbnailUri'>;

export function MediaThumbnail({ media, style, allowRuntimeVideoPoster = false }: { media: JournalMedia; style?: StyleProp<ViewStyle>; allowRuntimeVideoPoster?: boolean }) {
  if (isVideo(media)) return <VideoThumbnail media={media} style={style} allowRuntimePoster={allowRuntimeVideoPoster} />;
  return <View style={[styles.mediaThumb, style]}><Image source={media.uri} cachePolicy="memory-disk" contentFit="cover" style={StyleSheet.absoluteFill} /></View>;
}

export function MediaViewer({ media }: { media: JournalMedia }) {
  if (isVideo(media)) return <VideoPlayer uri={media.uri} />;
  return <ZoomableImage key={media.uri} uri={media.uri} />;
}

function isVideo(media: JournalMedia) {
  return media.mediaType === 'video'
    || Boolean(media.duration && media.duration > 0)
    || /\.(mp4|mov|m4v|webm)(?:$|\?)/i.test(media.uri);
}

function VideoThumbnail({ media, style, allowRuntimePoster }: { media: JournalMedia; style?: StyleProp<ViewStyle>; allowRuntimePoster: boolean }) {
  return <View style={[styles.videoThumb, style]}>
    {media.thumbnailUri ? <Image source={media.thumbnailUri} cachePolicy="memory-disk" contentFit="cover" style={StyleSheet.absoluteFill} /> : allowRuntimePoster ? <RuntimeVideoPoster uri={media.uri} /> : null}
    <VideoBadge duration={media.duration} />
  </View>;
}

function RuntimeVideoPoster({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.muted = true;
    instance.pause();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    if (status !== 'readyToPlay') return;
    if (player.currentTime < 0.05) player.seekBy(0.1);
    player.pause();
  }, [player, status]);
  return <VideoView player={player} nativeControls={false} contentFit="cover" surfaceType="textureView" style={StyleSheet.absoluteFill} />;
}

function VideoBadge({ duration }: { duration: number | null }) {
  return <>
    <View style={styles.playCircle}><Text style={styles.play}>▶</Text></View>
    {duration ? <Text style={styles.duration}>{formatDuration(duration)}</Text> : null}
  </>;
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
});
