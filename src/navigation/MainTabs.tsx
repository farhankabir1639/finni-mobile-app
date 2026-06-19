import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import HomeScreen from '../screens/HomeScreen';
import TransactionsScreen from '../screens/TransactionsScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import InvestmentsScreen from '../screens/InvestmentsScreen';
import ReviewScreen from '../screens/ReviewScreen';
import GlassDock from '../components/GlassDock';
import NavShelf, { Breadcrumb } from '../components/NavShelf';
import { useAuth } from '../contexts/AuthContext';

const Tab = createBottomTabNavigator();

function Tabs() {
  return (
    <Tab.Navigator tabBar={(props) => <GlassDock {...props} />} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Transactions" component={TransactionsScreen} />
      <Tab.Screen name="Analytics" component={AnalyticsScreen} />
      <Tab.Screen name="Investments" component={InvestmentsScreen} />
      <Tab.Screen name="Review" component={ReviewScreen} />
    </Tab.Navigator>
  );
}

// Settings is no longer a bottom tab — it's reached from the NavShelf (opened via
// the top breadcrumb). Review replaces it in the dock.
export default function MainTabs() {
  const navigation = useNavigation<any>();
  const { signOut } = useAuth();
  const [shelf, setShelf] = useState(false);

  // current tab name (for the shelf's active highlight)
  const activeTab = useNavigationState((state) => {
    try {
      const r: any = state.routes[state.index];
      const nested = r?.state;
      return nested?.routes?.[nested.index]?.name ?? 'Home';
    } catch {
      return 'Home';
    }
  });

  return (
    <View style={styles.root}>
      <Tabs />

      {/* persistent breadcrumb → opens the shelf */}
      <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.crumbBar}>
        <Breadcrumb onOpen={() => setShelf(true)} />
      </SafeAreaView>

      <NavShelf
        visible={shelf}
        active={activeTab}
        onClose={() => setShelf(false)}
        onNavigate={(tab) => navigation.navigate('MainTabs', { screen: tab })}
        onOpenSettings={(section) => navigation.navigate('Settings', section ? { open: section } : undefined)}
        onSignOut={() => { signOut(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  crumbBar: { position: 'absolute', top: 0, left: 16, right: 16 },
});
