import { consultarHealth } from './health';

function resposta(status: number, corpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(corpo) } as Response;
}

describe('consultarHealth', () => {
  it('devolve ok com o ambiente quando a API responde ok', async () => {
    const fetcher = jest.fn().mockResolvedValue(resposta(200, { status: 'ok', ambiente: 'dev' }));
    await expect(consultarHealth(fetcher)).resolves.toEqual({ estado: 'ok', ambiente: 'dev' });
    expect(fetcher).toHaveBeenCalledWith('http://localhost:3000/health', expect.anything());
  });

  it('devolve indisponível em 503', async () => {
    const fetcher = jest.fn().mockResolvedValue(resposta(503, { status: 'erro' }));
    await expect(consultarHealth(fetcher)).resolves.toEqual({ estado: 'indisponivel' });
  });

  it('devolve indisponível quando a rede falha', async () => {
    const fetcher = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(consultarHealth(fetcher)).resolves.toEqual({ estado: 'indisponivel' });
  });
});
