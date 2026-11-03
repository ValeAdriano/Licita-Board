import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { chamar, ErroApi } from '../../../api/cliente';
import { Botao, Mensagem } from '../../../ui/formulario';
import { useAcesso } from '../contexto';
import { filtrarPorPapel, iguais, resumoMudanca, rotuloPapel, sugestaoPorPapel, type Modulo, type Papel } from '../matriz';
import { MatrizEditavel } from './MatrizEditavel';
import { SeletorPapel } from './SeletorPapel';
import { StepUpModal } from './StepUpModal';
import type { Membro } from './tipos';

interface Pendente {
  papel: Papel;
  ativo: boolean;
  permissoes: string[];
}

// Edita papel, situação e permissões de um vínculo. Salvar é operação crítica: pede step-up e o que
// será gravado é congelado ao abrir a confirmação (mudança na tela depois disso não entra).
export function EditorVinculo(props: {
  membro: Membro;
  modulos: Modulo[];
  podeAdministrar: boolean;
  aoSalvar: () => void;
  aoFechar: () => void;
}) {
  const { membro, modulos, podeAdministrar, aoSalvar, aoFechar } = props;
  const { recarregar, pode } = useAcesso();
  const original = new Set(membro.permissoes);
  const [papel, setPapel] = useState<Papel>(membro.papel);
  const [ativo, setAtivo] = useState(membro.ativo);
  const [selecao, setSelecao] = useState<Set<string>>(original);
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const alterado = papel !== membro.papel || ativo !== membro.ativo || !iguais(selecao, original);

  const trocarPapel = (novo: Papel) => {
    setPapel(novo);
    setSelecao((s) => filtrarPorPapel(novo, s));
  };

  async function salvar(stepUp: string) {
    if (!pendente) return;
    try {
      await chamar('PUT', `/vinculos/${membro.vinculoId}`, { ...pendente, stepUp });
    } catch (e) {
      setPendente(null);
      setOk(null);
      // O código do autenticador já foi usado: um novo envio exige o próximo código.
      const motivo = e instanceof ErroApi ? e.message : 'Não foi possível salvar. Recarregue e tente de novo.';
      setErro(`${motivo} O código já foi usado: aguarde o próximo código do autenticador para tentar de novo.`);
      if (e instanceof ErroApi && e.status === 0) aoSalvar(); // pode ter gravado: confere a lista
      return;
    }
    setPendente(null);
    setErro(null);
    setOk('Permissões salvas.');
    aoSalvar();
    void recarregar().catch(() => {}); // as próprias permissões podem ter mudado
  }

  return (
    <View style={estilos.tela}>
      <View style={estilos.cabecalho}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={estilos.titulo}>
            {membro.nome || membro.email}
          </Text>
          <Text style={estilos.sub}>{membro.email}</Text>
        </View>
        <Botao secundario texto="Fechar" onPress={aoFechar} />
      </View>
      <Mensagem texto={erro} />
      <Mensagem tipo="info" texto={ok} />
      {!podeAdministrar ? <Mensagem tipo="info" texto="Você pode ver estas permissões, mas não alterá-las." /> : null}

      <Text style={estilos.rotulo}>Papel</Text>
      <SeletorPapel papel={papel} aoMudar={trocarPapel} desabilitado={!podeAdministrar} />
      <View style={estilos.linha}>
        <Switch value={ativo} onValueChange={setAtivo} disabled={!podeAdministrar} accessibilityLabel="Acesso ativo" />
        <Text>Acesso ativo</Text>
      </View>
      {podeAdministrar ? (
        <Botao secundario texto="Aplicar sugestão do papel (revise antes de salvar)" onPress={() => setSelecao(sugestaoPorPapel(papel, modulos))} />
      ) : null}

      <MatrizEditavel modulos={modulos} papel={papel} selecao={selecao} aoMudar={setSelecao} somenteLeitura={!podeAdministrar} podeConceder={pode} />

      {podeAdministrar ? (
        <Botao texto="Salvar alterações" onPress={() => alterado && setPendente({ papel, ativo, permissoes: [...selecao].sort() })} />
      ) : null}

      <StepUpModal
        aberto={pendente !== null}
        escopo="alterar_permissoes"
        descricao="Alterar permissões é uma operação crítica. Confira o resumo e digite o código do autenticador."
        resumo={
          pendente
            ? [
                `Alterar: ${membro.nome || membro.email}`,
                `Papel: ${rotuloPapel(pendente.papel)} · acesso ${pendente.ativo ? 'ativo' : 'inativo'}`,
                ...resumoMudanca(original, new Set(pendente.permissoes)),
              ]
            : []
        }
        aoConfirmar={salvar}
        aoCancelar={() => setPendente(null)}
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: { gap: 12 },
  cabecalho: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  titulo: { fontSize: 20, fontWeight: '700' },
  sub: { color: '#475569' },
  rotulo: { fontSize: 14, fontWeight: '600' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
