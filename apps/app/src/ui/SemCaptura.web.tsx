// No navegador não há como impedir captura de tela (e expo-screen-capture não existe no web: lança
// erro ao desmontar). A proteção no web é a chave e os códigos sumirem ao sair da tela.
export function SemCaptura() {
  return null;
}
