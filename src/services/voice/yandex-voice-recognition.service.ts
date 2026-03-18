import axios from 'axios';
import { Singleton } from 'typescript-ioc';

import { BaseService } from '@/services/app/base.service';

@Singleton
export class YandexVoiceRecognitionService extends BaseService {
  private readonly TAG = 'YandexVoiceRecognitionService';

  private readonly apiUrl = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize';

  private readonly apiKey = process.env.YANDEX_VOICE_API_KEY ?? '';

  private readonly maxShortAudioBytes = 1024 * 1024; // 1 MB

  private readonly defaultLanguage = 'ru-RU';

  private readonly defaultTopic = 'general';

  private readonly defaultFormat = 'oggopus';

  public transcribeShortAudio = async (audioBuffer: Buffer, languageCode?: string): Promise<string> => {
    if (!this.apiKey.trim()) {
      throw new Error('YANDEX_VOICE_API_KEY is not set');
    }

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return '';
    }

    if (audioBuffer.byteLength > this.maxShortAudioBytes) {
      throw new Error('Voice message is too large for Yandex short recognition (max 1 MB).');
    }

    const params = {
      lang: languageCode ?? this.defaultLanguage,
      topic: this.defaultTopic,
      profanityFilter: true,
      format: this.defaultFormat,
    };

    this.loggerService.info(this.TAG, `Yandex STT request: ${JSON.stringify(params)}`);

    try {
      const response = await axios.post(this.apiUrl, audioBuffer, {
        params,
        headers: {
          Authorization: `Api-Key ${this.apiKey}`,
          'Content-Type': 'application/octet-stream',
        },
        timeout: 45000,
      });

      const resultText = response.data?.result;

      this.loggerService.info(this.TAG, `Yandex STT response: ${JSON.stringify(response.data)}`);
  
      return typeof resultText === 'string' ? resultText.trim() : '';
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Yandex STT request failed: ${message}`);
    }
  };
}

