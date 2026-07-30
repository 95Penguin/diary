import { NotoSansSC_400Regular } from '@expo-google-fonts/noto-sans-sc/400Regular';
import { NotoSerifSC_400Regular } from '@expo-google-fonts/noto-serif-sc/400Regular';
import { useFonts } from 'expo-font';

export function useAppFonts() {
  const [loaded, error] = useFonts({
    ShishiSans: NotoSansSC_400Regular,
    ShishiSerif: NotoSerifSC_400Regular,
  });
  return loaded || Boolean(error);
}
