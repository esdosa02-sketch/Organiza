import { Directory, File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';

export type ExportOutcome = 'saved' | 'shared' | 'canceled';
export type PickOutcome = { canceled: true } | { canceled: false; text: string };

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function wasCanceled(error: unknown) {
  return error instanceof Error && /cancel/i.test(error.message);
}

/**
 * Android: the person chooses a folder (for example Descargas) and the file is
 * written there. iPhone: the share sheet opens so it can be saved in Archivos,
 * AirDrop or mail.
 */
export async function exportTextFile(fileName: string, contents: string): Promise<ExportOutcome> {
  if (Platform.OS === 'android') {
    let directory: Directory;
    try {
      directory = await Directory.pickDirectoryAsync();
    } catch (error) {
      if (wasCanceled(error)) {
        return 'canceled';
      }
      throw error;
    }
    directory.createFile(fileName, 'application/json').write(contents);
    return 'saved';
  }

  if (Platform.OS === 'ios') {
    const file = new File(Paths.cache, fileName);
    if (file.exists) {
      file.delete();
    }
    file.create();
    file.write(contents);
    const result = await Share.share({ url: file.uri });
    return result.action === Share.dismissedAction ? 'canceled' : 'shared';
  }

  throw new Error('Exporta el respaldo desde la app instalada en tu teléfono.');
}

export async function pickTextFile(): Promise<PickOutcome> {
  if (Platform.OS === 'web') {
    throw new Error('Restaura el respaldo desde la app instalada en tu teléfono.');
  }
  const picked = await File.pickFileAsync({
    // Android often labels downloaded or shared .json files with a generic type.
    mimeTypes: Platform.OS === 'ios' ? ['application/json'] : ['*/*'],
  });
  if (picked.canceled) {
    return { canceled: true };
  }
  if (picked.result.size > MAX_FILE_BYTES) {
    throw new Error('El archivo es demasiado grande para ser un respaldo de Organiza.');
  }
  return { canceled: false, text: await picked.result.text() };
}
