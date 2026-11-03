import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { chamar, ErroApi } from '../../../api/cliente';
import { Botao, Campo, Mensagem } from '../../../ui/formulario';
import { useAcesso } from '../contexto';
import { filtrarPorPapel, rotuloPapel, sugestaoPorPapel, type Modulo, type Papel } from '../matriz';
import { MatrizEditavel } from './MatrizEditavel';
import { SeletorPapel } from './SeletorPapel';
import { StepUpModal } from './StepUpModal';

// Convite (spec §6 regra 13): preso à conta do convidado, vale 7 dias; a resposta da API é a mesma
// exista ou não a conta. Quem convida não pode dar mais do que tem (teto, conferido no banco).
export function ConvidarUsuario(props: { empresaId: string; modulos: Modulo[]; aoConcluir: () => void; aoCancelar: () => void }) {
  const { empresaId, modulos, aoConcluir, aoCancelar } = props;
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<Papel>('OPERADOR');
  // Começa vazio: a sugestão do papel é ampla e só entra por escolha explícita de quem convida.
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const { pode } = useAcesso();
  const [pendente, setPendente] = useState<{ email: string; papel: Papel; permissoes: string[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const trocarPapel = (novo: Papel) => {
    setPapel(novo);
    setSelecao((s) => filtrarPorPapel(novo, s));
  };

  function revisar() {
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setErro('Informe um e-mail válido.');
    setErro(null);
    setPendente({ email: e, papel, permissoes: [...filtrarPorPapel(papel, selecao)].sort() });
  }

  async function enviar(stepUp: string) {
    if (!pendente) return;
    try {
      await chamar('POST', `/empresas/${empresaId}/convites`, { ...pendente, stepUp });
    } catch (e) {
      setPendente(null);
      const motivo = e instanceof ErroApi ? e.message : 'Não foi possível convidar. Tente de novo.';
      setErro(`${motivo} O código já foi usado: aguarde o próximo código do autenticador para tentar de novo.`);
      return;
    }
    setPendente(null);
    aoConcluir();
  }

  return (
    <View style={estilos.tela}>
      <Text accessibilityRole="header" style={estilos.titulo}>
        Convidar usuário
      </Text>
      <Campo rotulo="E-mail do convidado" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
      <Text style={estilos.rotulo}>Papel</Text>
      <SeletorPapel papel={papel} aoMudar={trocarPapel} />
      <Text style={estilos.dica}>O convite vale por 7 dias e só pode ser aceito pela conta com este e-mail, já verificado.</Text>
      <Botao secundario texto="Aplicar sugestão do papel (revise antes de enviar)" onPress={() => setSelecao(filtrarPorPapel(papel, sugestaoPorPapel(papel, modulos)))} />
      <MatrizEditavel modulos={modulos} papel={papel} selecao={selecao} aoMudar={setSelecao} somenteLeitura={false} podeConceder={pode} />
      <Mensagem texto={erro} />
      <Botao texto="Enviar convite" onPress={revisar} />
      <Botao secundario texto="Cancelar" onPress={aoCancelar} />
      <StepUpModal
        aberto={pendente !== null}
        escopo="alterar_permissoes"
        descricao="Convidar alguém concede acesso: é uma operação crítica. Confira o resumo e digite o código do autenticador."
        resumo={
          pendente
            ? [`Convidar: ${pendente.email}`, `Papel: ${rotuloPapel(pendente.papel)}`, `Permissões: ${pendente.permissoes.length}`]
            : []
        }
        aoConfirmar={enviar}
        aoCancelar={() => setPendente(null)}
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: { gap: 12 },
  titulo: { fontSize: 20, fontWeight: '700' },
  rotulo: { fontSize: 14, fontWeight: '600' },
  dica: { fontSize: 12, color: '#475569' },
});
