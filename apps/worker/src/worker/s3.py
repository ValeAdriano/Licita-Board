import boto3

from worker.settings import Settings


class ArmazenamentoS3:
    """Acesso do worker ao bucket (credencial própria, ADR-017)."""

    def __init__(self, s: Settings) -> None:
        self._bucket = s.s3_bucket
        self._c = boto3.client(
            "s3",
            endpoint_url=s.s3_endpoint,
            aws_access_key_id=s.s3_access_key,
            aws_secret_access_key=s.s3_secret_key.get_secret_value(),
            region_name="us-east-1",
        )

    def ler(self, chave: str) -> bytes:
        return bytes(self._c.get_object(Bucket=self._bucket, Key=chave)["Body"].read())

    def copiar(self, origem: str, destino: str) -> None:
        self._c.copy_object(
            Bucket=self._bucket, Key=destino, CopySource={"Bucket": self._bucket, "Key": origem}
        )

    def apagar(self, chave: str) -> None:
        self._c.delete_object(Bucket=self._bucket, Key=chave)
