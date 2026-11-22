// Native (iOS/Android) start-up: status bar, splash screen and the Android back button.
// Loaded only inside the Capacitor app, so the web build never pulls these plugins in eagerly.
export async function nativeBootstrap() {
  const [{ StatusBar, Style }, { SplashScreen }, { App }] = await Promise.all([
    import('@capacitor/status-bar'), import('@capacitor/splash-screen'), import('@capacitor/app'),
  ]);
  await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  await StatusBar.setBackgroundColor({ color: '#0A2342' }).catch(() => {}); // Android only
  await SplashScreen.hide().catch(() => {});
  // Android hardware back: go back inside the app, leave only from the start screen.
  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && location.hash && location.hash !== '#/' && location.hash !== '#/dashboard') history.back();
    else App.exitApp();
  });
}
