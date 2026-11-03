import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useWindowDimensions, type ColorValue } from 'react-native';
import { AcessoProvider, useAcesso } from '../../features/acesso/contexto';
import { SeletorEmpresa } from '../../features/acesso/SeletorEmpresa';

type NomeIcone = ComponentProps<typeof Ionicons>['name'];
const icone = (nome: NomeIcone) =>
  function Icone({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={nome} color={typeof color === 'string' ? color : undefined} size={size} />;
  };

// Shell (RF-01.14): abas embaixo no celular, menu lateral no web largo; empresa no cabeçalho.
function Abas() {
  const { width } = useWindowDimensions();
  const { naoLidas, pode } = useAcesso();
  const largo = width >= 768;
  return (
    <Tabs
      screenOptions={{
        tabBarPosition: largo ? 'left' : 'bottom',
        tabBarVariant: largo ? 'material' : 'uikit',
        headerRight: () => <SeletorEmpresa />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icone('home-outline') }} />
      <Tabs.Screen
        name="notificacoes"
        options={{
          title: 'Notificações',
          tabBarIcon: icone('notifications-outline'),
          tabBarBadge: naoLidas > 0 ? naoLidas : undefined,
        }}
      />
      <Tabs.Screen
        name="equipe"
        options={{ title: 'Equipe', tabBarIcon: icone('people-outline'), href: pode('usuarios', 'visualizar') ? undefined : null }}
      />
      <Tabs.Screen name="conta" options={{ title: 'Conta', tabBarIcon: icone('person-circle-outline') }} />
    </Tabs>
  );
}

export default function Layout() {
  return (
    <AcessoProvider>
      <Abas />
    </AcessoProvider>
  );
}
