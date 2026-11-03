import { useState } from 'react';
import { chamar } from '../../../api/cliente';
import { Botao, Campo, Mensagem } from '../../../ui/formulario';
import { useAcesso, type Usuario } from '../contexto';
import { Secao } from './Secao';
import { useEnvio } from './useEnvio';

export function Perfil({ usuario }: { usuario: Usuario }) {
  const { recarregar } = useAcesso();
  const [nome, setNome] = useState(usuario.nome);
  const [telefone, setTelefone] = useState(usuario.telefone ?? '');
  const [oab, setOab] = useState(usuario.oab ?? '');
  const { enviando, erro, ok, enviar } = useEnvio();

  const salvar = () =>
    enviar(async () => {
      await chamar('PATCH', '/me', { nome: nome.trim(), telefone: telefone.trim() || null, oab: oab.trim() || null });
      await recarregar();
      return 'Dados salvos.';
    });

  return (
    <Secao titulo="Seus dados">
      <Campo rotulo="E-mail" value={usuario.email} editable={false} />
      <Campo rotulo="Nome" value={nome} onChangeText={setNome} autoCapitalize="words" maxLength={200} />
      <Campo rotulo="Telefone" value={telefone} onChangeText={setTelefone} keyboardType="phone-pad" maxLength={30} />
      <Campo rotulo="OAB" value={oab} onChangeText={setOab} maxLength={30} />
      <Mensagem texto={erro} />
      <Mensagem tipo="info" texto={ok} />
      <Botao texto="Salvar dados" onPress={() => void salvar()} carregando={enviando} />
    </Secao>
  );
}
