import type { INestApplication } from '@nestjs/common';
import { inflateRawSync } from 'node:zlib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SENHA, admin, cnpjFicticio, criarEmpresa, criarUsuario, ipNovo, servidor, subirApp, totpDaUri, vincular } from './apoio.js';

// Dashboard e relatórios da Fase 12: indicadores iguais aos registros, só o autorizado aparece, CSV e A x B.
describe('dashboard: indicadores, permissões e A x B', () => {
  let app: INestApplication;
  const http = () => request.agent(servidor(app)).set('X-Forwarded-For', ipNovo());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  async function entrar(email: string): Promise<string> {
    const login = await http().post('/auth/login').send({ email, senha: SENHA, plataforma: 'ios' }).expect(200);
    const t0 = (login.body as { token: string }).token;
    const cad = await http().post('/auth/mfa/cadastrar').set(bearer(t0)).send({ senha: SENHA }).expect(200);
    const conf = await http().post('/auth/mfa/confirmar').set(bearer(t0)).send({ codigo: totpDaUri((cad.body as { uri: string }).uri) }).expect(200);
    await admin.query(`update core.fatores_mfa set verificado_em = now() - interval '2 days' where usuario_id = (select id from core.usuarios where email = $1)`, [email]);
    return (conf.body as { token: string }).token;
  }

  let empA: string; let empB: string; let a: string; let b: string; let limitado: string; let semExportar: string;

  beforeAll(async () => {
    app = await subirApp();
    empA = await criarEmpresa('Dash A'); empB = await criarEmpresa('Dash B');
    const [eA, eB, eL, eS] = await Promise.all([criarUsuario('da-a'), criarUsuario('da-b'), criarUsuario('da-l'), criarUsuario('da-s')]);
    await vincular(eS, empA, 'OPERADOR', ['agenda:visualizar']);
    await vincular(eA, empA); await vincular(eB, empB);
    await vincular(eL, empA, 'OPERADOR', ['agenda:visualizar', 'agenda:exportar']); // sem contratos, financeiro, documentos, propostas
    [a, b, limitado, semExportar] = await Promise.all([entrar(eA), entrar(eB), entrar(eL), entrar(eS)]);
    const fonte = (await admin.query<{ id: string }>(`select id from ops.fontes where slug = 'pncp'`)).rows[0]?.id;
    const orgao = (await admin.query<{ id: string }>(`insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ($1, 'Órgão Dash', 'PR', '4106902') returning id`, [cnpjFicticio()])).rows[0]?.id;
    const edital = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo) values ($1, $2, $3, '8/2026', 'Objeto', repeat('2', 64)) returning id`, [fonte, `DB-${crypto.randomUUID()}`, orgao])).rows[0]?.id;
    const itens = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao) select $1, n, 'Item ' || n from generate_series(1, 3) n returning id`, [edital])).rows.map((r) => r.id);
    const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id, data_abertura) values ($1, $2, now() + interval '10 days') returning id`, [empA, edital])).rows[0]?.id;
    const parts: string[] = [];
    for (const [i, it] of itens.entries()) parts.push((await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id, status, marca, modelo) values ($1, $2, $3, 'em_disputa', 'Marca ${String(i % 2)}', 'Mod') returning id`, [empA, ac, it])).rows[0]?.id ?? '');
    await admin.query(`insert into priv.resultados_item (empresa_id, participacao_id, resultado_final, valor_final) values ($1, $2, 'homologada', 1000.50), ($1, $3, 'perdida', 2000)`, [empA, parts[0], parts[1]]);
    await admin.query(`insert into priv.resultados_item (empresa_id, participacao_id, resultado_final, valor_final, motivo_perda) values ($1, $2, 'inabilitada', 500, 'Atestado incompatível')`, [empA, parts[2]]);
    await admin.query(
      `insert into priv.precificacoes (empresa_id, participacao_id, quantidade, margem_desejada_pct, margem_minima_pct, margem_bruta_pct, margem_liquida_pct, calculado_em)
       values ($1, $2, 1, 20, 10, 28.5000, 16.2500, now())`,
      [empA, parts[0]],
    );
    await admin.query(
      `insert into pub.precos_historicos (fonte_id, id_externo, edital_id, edital_item_id, situacao, cancelado, fornecedor_tipo, fornecedor_nome, marca, modelo, quantidade, unidade_medida, valor_unitario, valor_total, data_resultado, hash_conteudo, link_origem)
       values ($1, $4, $2, $3, 'homologado', false, 'pj', 'Vencedora PNCP', 'MarcaV', 'ModV', 1, 'UN', 950.2500, 950.2500, '2026-10-10T10:00:00Z', repeat('a', 64), 'https://pncp.gov.br/app/editais/dash')`,
      [fonte, edital, itens[0], `DASH-${crypto.randomUUID()}`],
    );
    const ct = (await admin.query<{ id: string }>(`insert into priv.contratos (empresa_id, numero, orgao, objeto, vigencia_inicio, vigencia_fim, valor_total) values ($1, 'C1', 'Órgão', 'Obj', '2026-01-01', '2030-12-31', 5000) returning id`, [empA])).rows[0]?.id;
    await admin.query(`insert into priv.empenhos (empresa_id, contrato_id, numero, emitido_em, etapa) values ($1, $2, 'E1', '2026-02-01', 'transporte'), ($1, $2, 'E2', '2026-02-02', 'concluido')`, [empA, ct]);
    await admin.query(`insert into priv.faturas (empresa_id, contrato_id, numero_nf, emitida_em, valor, retencoes, vencimento) values ($1, $2, 'NF1', '2026-03-01', 3000, 500, '2026-04-01')`, [empA, ct]);
    await admin.query(`insert into priv.faturas (empresa_id, contrato_id, numero_nf, emitida_em, valor, retencoes, vencimento, pago_em, valor_recebido) values ($1, $2, 'NF2', '2026-03-02', 1000, 0, '2026-04-02', '2026-04-02', 1000)`, [empA, ct]);
    const tipo = (await admin.query<{ id: string }>(`select id from pub.tipos_documento limit 1`)).rows[0]?.id;
    const doc = (await admin.query<{ id: string }>(`insert into priv.documentos (empresa_id, tipo_id, descricao) values ($1, $2, 'CND vencida') returning id`, [empA, tipo])).rows[0]?.id;
    await admin.query(`insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, validade, status_arquivo) values ($1, $2, 1, 'k/1', 'a.pdf', current_date - 5, 'liberado')`, [doc, empA]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('os indicadores batem com os registros (contagens e somas conferidas à parte)', async () => {
    const d = (await http().get(`/empresas/${empA}/dashboard`).set(bearer(a)).expect(200)).body as Record<string, unknown>;
    expect(d).toMatchObject({
      disputasFuturas: 1, licitacoesGanhas: 1, valorGanho: '1000.5000', contratosAtivos: 1, entregasPendentes: 1, // E2 já concluído não conta
      valoresAReceber: '2500.0000', // NF1: 3.000 - 500 de retenção; NF2 já paga
      documentosVencidos: 1, documentosVencendo: 0, propostasPendentes: 0, analisesPendentes: 0, oportunidadesNovas: 0, prazosJuridicosAbertos: 0,
    });
  });

  it('quem não tem a permissão do módulo recebe null (nunca zero enganoso); B não vê nada de A', async () => {
    const d = (await http().get(`/empresas/${empA}/dashboard`).set(bearer(limitado)).expect(200)).body as Record<string, unknown>;
    expect([d['contratosAtivos'], d['entregasPendentes'], d['valoresAReceber'], d['documentosVencidos'], d['propostasPendentes'], d['analisesPendentes'], d['oportunidadesNovas']]).toEqual([null, null, null, null, null, null, null]);
    expect([d['licitacoesGanhas'], d['disputasFuturas']]).toEqual([1, 1]); // o que a agenda autoriza continua aparecendo
    await http().get(`/empresas/${empA}/dashboard`).set(bearer(b)).expect(404);
    const dB = (await http().get(`/empresas/${empB}/dashboard`).set(bearer(b)).expect(200)).body as Record<string, unknown>;
    expect([dB['licitacoesGanhas'], dB['valorGanho'], dB['contratosAtivos'], dB['valoresAReceber'], dB['documentosVencidos']]).toEqual([0, '0.0000', 0, '0.0000', 0]);
  });

  it('relatório comercial: vitórias, derrotas, taxa de sucesso, valores, motivos, produtos, margens (sigilo) e preços vencedores anteriores', async () => {
    const r = (await http().get(`/empresas/${empA}/relatorios/comercial`).set(bearer(limitado)).expect(200)).body as {
      participacoes: number; vitorias: number; derrotas: number; taxaSucessoPct: string; valorDisputado: string; valorGanho: string;
      motivos: { motivo: string; total: number }[]; produtos: { produto: string; total: number }[];
      margens: unknown; precosVencedoresAnteriores: { vencedora: string; valorUnitario: string; marcaModelo: string }[];
    };
    expect([r.participacoes, r.vitorias, r.derrotas, r.taxaSucessoPct, r.valorDisputado, r.valorGanho]).toEqual([3, 1, 2, '33.33', '3500.5000', '1000.5000']);
    expect(r.motivos.map((m) => m.motivo)).toContain('Atestado incompatível');
    expect(r.produtos.map((p) => [p.produto, p.total])).toEqual([['Marca 0 Mod', 2], ['Marca 1 Mod', 1]]);
    expect(r.margens).toBeNull(); // sem precos/ver_custos_margens vem null, nunca zero enganoso
    expect(r.precosVencedoresAnteriores).toBeNull(); // sem editais/visualizar vem null

    const rAdmin = (await http().get(`/empresas/${empA}/relatorios/comercial`).set(bearer(a)).expect(200)).body as {
      margens: { avaliadas: number; mediaBrutaPct: string; mediaLiquidaPct: string; minimaLiquidaPct: string; maximaLiquidaPct: string } | null;
      precosVencedoresAnteriores: { vencedora: string; valorUnitario: string; marcaModelo: string }[];
    };
    expect(rAdmin.margens).toEqual({
      avaliadas: 1,
      mediaBrutaPct: '28.5000',
      mediaLiquidaPct: '16.2500',
      minimaLiquidaPct: '16.2500',
      maximaLiquidaPct: '16.2500',
    });
    expect(rAdmin.precosVencedoresAnteriores).toMatchObject([{ vencedora: 'Vencedora PNCP', valorUnitario: '950.2500', marcaModelo: 'MarcaV ModV' }]);
    await http().get(`/empresas/${empA}/relatorios/comercial`).set(bearer(b)).expect(404);
    const rB = (await http().get(`/empresas/${empB}/relatorios/comercial`).set(bearer(b)).expect(200)).body as { taxaSucessoPct: string | null; precosVencedoresAnteriores: unknown[] };
    expect(rB.taxaSucessoPct).toBeNull();
    expect(rB.precosVencedoresAnteriores).toEqual([]);
  });

  it('relatório diário por e-mail: opt-in da própria pessoa; B não liga nem vê a assinatura de A', async () => {
    const u = `/empresas/${empA}/relatorio-diario`;
    expect((await http().get(u).set(bearer(limitado)).expect(200)).body).toEqual({ ativo: false });
    await http().put(u).set(bearer(limitado)).send({ ativo: 'sim' }).expect(400);
    await http().put(u).set(bearer(limitado)).send({ ativo: true }).expect(204);
    expect((await http().get(u).set(bearer(limitado)).expect(200)).body).toEqual({ ativo: true });
    expect((await http().get(u).set(bearer(a)).expect(200)).body).toEqual({ ativo: false }); // a assinatura é de cada pessoa
    await http().get(u).set(bearer(b)).expect(404);
    await http().put(u).set(bearer(b)).send({ ativo: true }).expect(404);
    await http().put(`/empresas/${empB}/relatorio-diario`).set(bearer(limitado)).send({ ativo: true }).expect(404); // sem vínculo em B
    await http().put(u).set(bearer(limitado)).send({ ativo: false }).expect(204);
    expect((await http().get(u).set(bearer(limitado)).expect(200)).body).toEqual({ ativo: false });
  });

  // Lê as partes de um .xlsx (ZIP) pelo diretório central: prova que o arquivo é um pacote válido e deixa conferir o conteúdo.
  function partesXlsx(buf: Buffer): Map<string, string> {
    const fim = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const total = buf.readUInt16LE(fim + 10);
    let p = buf.readUInt32LE(fim + 16);
    const partes = new Map<string, string>();
    for (let i = 0; i < total; i++) {
      const comp = buf.readUInt32LE(p + 20); const nomeLen = buf.readUInt16LE(p + 28); const local = buf.readUInt32LE(p + 42);
      const nome = buf.subarray(p + 46, p + 46 + nomeLen).toString('utf8');
      const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      partes.set(nome, inflateRawSync(buf.subarray(ini, ini + comp)).toString('utf8'));
      p += 46 + nomeLen;
    }
    return partes;
  }
  const baixar = async (u: string, token: string, status = 200): Promise<Buffer> => (await http().get(u).set(bearer(token)).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => { cb(null, Buffer.concat(c)); }); }).expect(status)).body as Buffer;

  it('Excel: relatório comercial e resultados, só com agenda/exportar, valores exatos do banco e pacote válido', async () => {
    const com = partesXlsx(await baixar(`/empresas/${empA}/relatorios/comercial.xlsx`, limitado));
    expect(com.get('xl/workbook.xml')).toContain('name="Resumo"');
    expect(com.get('xl/workbook.xml')).toContain('name="Motivos de perda"');
    const resumo = com.get('xl/worksheets/sheet1.xml') ?? '';
    expect(resumo).toContain('Valor ganho (R$)');
    expect(resumo).toContain('<v>1000.5000</v>'); // valor ganho = só a homologada, texto decimal exato
    expect(com.get('xl/worksheets/sheet2.xml')).toContain('Atestado incompatível');
    const res = partesXlsx(await baixar(`/empresas/${empA}/relatorios/resultados.xlsx`, limitado));
    const planilha = res.get('xl/worksheets/sheet1.xml') ?? '';
    expect(planilha).toContain('homologada');
    expect(planilha).toContain('<v>1000.5000</v>');
    expect((planilha.match(/<row /g) ?? []).length).toBe(4); // cabeçalho + 3 resultados
    for (const u of ['relatorios/comercial.xlsx', 'relatorios/resultados.xlsx']) {
      await http().get(`/empresas/${empA}/${u}`).set(bearer(semExportar)).expect(404); // sem exportar
      await http().get(`/empresas/${empA}/${u}`).set(bearer(b)).expect(404);
    }
  });

  it('CSV de resultados: só com agenda/exportar, BOM, separador ; e valores do banco', async () => {
    const r = await http().get(`/empresas/${empA}/relatorios/resultados.csv`).set(bearer(limitado)).expect(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.text.startsWith('\uFEFFData;Órgão;Edital;')).toBe(true);
    expect(r.text.split('\r\n').filter(Boolean)).toHaveLength(4); // cabeçalho + 3 resultados
    expect(r.text).toContain('homologada');
    expect(r.text).toContain('1000.5000');
    await http().get(`/empresas/${empA}/relatorios/resultados.csv`).set(bearer(b)).expect(404);
    await http().get(`/empresas/${empA}/relatorios/resultados.csv`).set(bearer(semExportar)).expect(404); // sem exportar
  });
  for (const dona of ['A', 'B'] as const) {
    it(`isolamento por endpoint: dashboard/relatórios de ${dona} nas 7 rotas`, async () => {
      const empresas = [await criarEmpresa('Matriz A fictícia'), await criarEmpresa('Matriz B fictícia')] as const;
      const usuarios = [await criarUsuario('matriz-a'), await criarUsuario('matriz-b')] as const;
      await vincular(usuarios[0], empresas[0]); await vincular(usuarios[1], empresas[1]);
      const tokens = [await entrar(usuarios[0]), await entrar(usuarios[1])] as const;
      const empresa = empresas[dona === 'A' ? 0 : 1];
      const outra = empresas[dona === 'A' ? 1 : 0];
      const token = tokens[dona === 'A' ? 0 : 1];
      const invasor = tokens[dona === 'A' ? 1 : 0];
      const marcador = `MATRIZ-${crypto.randomUUID()}`;
      const valor = dona === 'A' ? '87654.3211' : '76543.2122';
      const ed = (await admin.query<{ id: string }>(`insert into pub.editais (fonte_id, orgao_id, id_externo, objeto, hash_conteudo) select id, (select id from pub.orgaos limit 1), $1, $1, repeat('c',64) from ops.fontes limit 1 returning id`, [marcador])).rows[0]?.id;
      const item = (await admin.query<{ id: string }>(`insert into pub.edital_itens (edital_id, numero_item, descricao) values ($1,1,$2) returning id`, [ed, marcador])).rows[0]?.id;
      const ac = (await admin.query<{ id: string }>(`insert into priv.acompanhamentos (empresa_id, edital_id) values ($1,$2) returning id`, [empresa, ed])).rows[0]?.id;
      const pa = (await admin.query<{ id: string }>(`insert into priv.participacoes (empresa_id, acompanhamento_id, item_id, marca, modelo) values ($1,$2,$3,$4,'Fictício') returning id`, [empresa, ac, item, marcador])).rows[0]?.id;
      const resultado = (await admin.query<{ id: string }>(`insert into priv.resultados_item (empresa_id, participacao_id, resultado_final, valor_final) values ($1,$2,'homologada',$3) returning id`, [empresa, pa, valor])).rows[0]?.id ?? '';
      const snapshot = async () => (await admin.query<Record<string, unknown>>(`select (select jsonb_agg(r order by r.id) from priv.resultados_item r where empresa_id = $1) as resultados, (select jsonb_agg(s order by s.id) from priv.relatorio_diario_assinaturas s where empresa_id = $1) as assinaturas`, [empresa])).rows;
      const raiz = `/empresas/${empresa}`;
      await http().put(`${raiz}/relatorio-diario`).set(bearer(token)).send({ ativo: true }).expect(204);
      const antes = await snapshot();
      for (const rota of ['dashboard', 'relatorios/comercial', 'relatorios/comercial.xlsx', 'relatorios/resultados.csv', 'relatorios/resultados.xlsx', 'relatorio-diario']) {
        await http().get(`${raiz}/${rota}`).set(bearer(invasor)).expect(404);
        const url = `/empresas/${outra}/${rota}`;
        let conteudo: string;
        if (rota.endsWith('.xlsx')) {
          conteudo = [...partesXlsx(await baixar(url, invasor)).values()].join('');
          const proprio = [...partesXlsx(await baixar(`${raiz}/${rota}`, token)).values()].join('');
          expect(proprio).toContain(valor);
        } else {
          const r = await http().get(url).set(bearer(invasor)).expect(200);
          conteudo = rota.endsWith('.csv') ? r.text : JSON.stringify(r.body);
          if (rota.endsWith('.csv')) expect((await http().get(`${raiz}/${rota}`).set(bearer(token)).expect(200)).text).toContain(valor);
        }
        for (const segredo of [marcador, valor, resultado, ac ?? '', pa ?? '']) expect(conteudo).not.toContain(segredo);
        expect(await snapshot()).toEqual(antes);
      }
      await http().put(`${raiz}/relatorio-diario`).set(bearer(invasor)).send({ ativo: false }).expect(404);
      await http().put(`/empresas/${outra}/relatorio-diario`).set(bearer(invasor)).send({ ativo: true }).expect(204);
      expect(await snapshot()).toEqual(antes);
      expect((await http().get(`${raiz}/relatorio-diario`).set(bearer(token)).expect(200)).body).toEqual({ ativo: true });
    });
  }

});
