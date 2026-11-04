import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Config } from '../config.js';
import { CONFIG } from '../tokens.js';

// URLs assinadas (ADR-017). A API não lê nem grava arquivo: só assina. Upload vale 5 min, só para a chave
// de quarentena criada pelo banco; download vale 60 s, só para versão liberada e registrada.
@Injectable()
export class S3Servico {
  private readonly cliente: S3Client | null;
  private readonly bucket: string;

  constructor(@Inject(CONFIG) config: Config) {
    this.bucket = config.S3_BUCKET;
    const url = config.S3_PUBLIC_URL || config.S3_ENDPOINT;
    this.cliente = url && this.bucket && config.S3_ACCESS_KEY
      ? new S3Client({ endpoint: url, region: 'us-east-1', forcePathStyle: true,
        // Sem checksum embutido na URL: o navegador envia o corpo cru (o SDK novo pré-calcularia o hash do corpo vazio).
        requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY } })
      : null;
  }

  private c(): S3Client {
    if (!this.cliente) throw new ServiceUnavailableException('Repositório de documentos indisponível.');
    return this.cliente;
  }

  urlParaEnviar(chave: string, tamanho: number): Promise<string> {
    return getSignedUrl(this.c(), new PutObjectCommand({ Bucket: this.bucket, Key: chave, ContentLength: tamanho }), { expiresIn: 300 });
  }

  urlParaBaixar(chave: string, nome: string): Promise<string> {
    const seguro = nome.replace(/[^\w.\- ]/g, '_').slice(0, 120);
    return getSignedUrl(this.c(), new GetObjectCommand({ Bucket: this.bucket, Key: chave, ResponseContentDisposition: `attachment; filename="${seguro}"` }), { expiresIn: 60 });
  }
}
