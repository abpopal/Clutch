import 'package:flutter/material.dart';

class ClutchBrand {
  static const String appName = 'Clutch';
  static const String fontFamily = 'Clutch';

  static const Color ink = Color(0xFF0F0D0D);
  static const Color coal = Color(0xFF141013);
  static const Color surface = Color(0xFF1D181C);
  static const Color surfaceAlt = Color(0xFF272126);
  static const Color line = Color(0xFF3A3238);
  static const Color frost = Color(0xFFF4F2F1);

  static const Color ember = Color(0xFFE0462E);
  static const Color emberDeep = Color(0xFF8E1F18);
  static const Color gold = Color(0xFFFFB547);
  static const Color mint = Color(0xFF66E6C3);

  static const LinearGradient emberGradient = LinearGradient(
    colors: [Color(0xFFE0462E), Color(0xFF8E1F18)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient panelGradient = LinearGradient(
    colors: [Color(0xFF2B2228), Color(0xFF171316)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const BorderRadius cardRadius = BorderRadius.all(Radius.circular(20));
  static const BorderRadius chipRadius = BorderRadius.all(Radius.circular(24));

  static ThemeData theme() {
    final textTheme = const TextTheme(
      displaySmall: TextStyle(fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: 0.4),
      headlineSmall: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
      titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, letterSpacing: 0.2),
      titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      bodyLarge: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, height: 1.4),
      bodyMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.w400, height: 1.4),
      labelLarge: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 0.4),
    ).apply(
      fontFamily: fontFamily,
      bodyColor: frost,
      displayColor: frost,
    );

    return ThemeData(
      brightness: Brightness.dark,
      useMaterial3: true,
      scaffoldBackgroundColor: Colors.transparent,
      fontFamily: fontFamily,
      fontFamilyFallback: const ['Roboto', 'Arial'],
      textTheme: textTheme,
      colorScheme: const ColorScheme.dark(
        primary: ember,
        secondary: gold,
        surface: surface,
        onSurface: frost,
        background: ink,
        onBackground: frost,
      ),
    );
  }
}
