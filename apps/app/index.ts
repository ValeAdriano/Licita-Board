// Entry do app: tira o token de redefinição da URL antes de o Expo Router ler a URL inicial (senão
// ele guarda o fragmento no estado e o reescreve na barra de endereço e no histórico).
import './src/auth/fragmento';
import 'expo-router/entry';
