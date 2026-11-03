import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { chamar, ErroApi } from '../../../api/cliente';
import { Botao, Mensagem } from '../../../ui/formulario';
import { useAcesso } from '../contexto';
import { rotuloPapel } from '../matriz';
import { useGet } from '../useGet';

export interface ConviteRecebido {
  id: string;
  empresa: string;
  cnpj: string;
  convidado_por: string | null;
  papel: string;
  permissoes: string[];
  expira_em: string;
}

// CNPJ com máscara só para ler (00.000.000/0000-00); alfanumérico (12 + 2 dígitos) segue o mesmo corte.
export function cnpjLegivel(cnpj: string): string {
  return /^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)
    ? `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
    : cnpj;
}

// Convites que a própria conta recebeu (a API só devolve os válidos e os cobertos pelo autor). O nome
// da empresa é texto livre de terceiro (T3.1c): antes de aceitar, a pessoa vê CNPJ, quem convidou, o
// papel e as permissões. Aceitar liga o vínculo e atualiza o app.
export function ConvitesRecebidos() {
  const { recarregar } = useAcesso();
  const { dados, recarregar: recarregarLista } = useGet<ConviteRecebido[]>('/me/convites');
  const [erro, setErro] = useState<string | null>(null);
  const [revisando, setRevisando] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function aceitar(id: string) {
    setEnviando(true);
    setErro(null);
    try {
      await chamar('POST', `/me/convites/${id}/aceitar`);
      setRevisando(null);
      await recarregar().catch(() => {});
      recarregarLista();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível aceitar o convite.');
    } finally {
      setEnviando(false);
    }
  }

  if (!dados || dados.length === 0) return null;
  return (
    <View style={estilos.caixa}>
      <Text accessibilityRole="header" style={estilos.titulo}>
        Convites recebidos
      </Text>
      {dados.map((c) => (
        <View key={c.id} style={estilos.item}>
          <Text style={estilos.empresa}>{c.empresa}</Text>
          <Text style={estilos.sub}>CNPJ {cnpjLegivel(c.cnpj)}</Text>
          <Text style={estilos.sub}>Convidado por {c.convidado_por ?? 'usuário desconhecido'}</Text>
          <Text style={estilos.sub}>
            {rotuloPapel(c.papel)} · {c.permissoes.length} permissão(ões) · vence em {new Date(c.expira_em).toLocaleDateString('pt-BR')}
          </Text>
          {revisando === c.id ? (
            <>
              <Text style={estilos.aviso}>
                Confira se a empresa e quem convidou são os esperados. Ao aceitar, você terá acesso a esta empresa com as permissões acima.
              </Text>
              <Botao texto="Confirmar e aceitar" onPress={() => void aceitar(c.id)} carregando={enviando} />
              <Botao secundario texto="Voltar" onPress={() => setRevisando(null)} />
            </>
          ) : (
            <Botao texto="Revisar convite" onPress={() => setRevisando(c.id)} />
          )}
        </View>
      ))}
      <Mensagem texto={erro} />
    </View>
  );
}

const estilos = StyleSheet.create({
  caixa: { gap: 8, borderWidth: 1, borderColor: '#1D4ED8', borderRadius: 12, padding: 12, backgroundColor: '#EFF6FF' },
  titulo: { fontSize: 16, fontWeight: '700' },
  item: { gap: 4 },
  empresa: { fontWeight: '600' },
  sub: { fontSize: 12, color: '#475569' },
  aviso: { fontSize: 13, color: '#92400E' },
});
