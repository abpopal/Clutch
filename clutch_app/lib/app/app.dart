import 'package:flutter/material.dart';

import 'brand.dart';
import 'root_page.dart';

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: ClutchBrand.appName,
      debugShowCheckedModeBanner: false,
      theme: ClutchBrand.theme(),
      home: const RootPage(),
    );
  }
}
