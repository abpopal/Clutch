import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'brand.dart';
import 'creator_profile_page.dart';
import 'design_showcase_page.dart';
import 'explorer_page.dart';
import 'highlights_page.dart';
import '../features/auth/login_page.dart';

class RootPage extends StatefulWidget {
  const RootPage({super.key});

  @override
  State<RootPage> createState() => _RootPageState();
}

class _RootPageState extends State<RootPage> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<AuthState>(
      stream: Supabase.instance.client.auth.onAuthStateChange,
      builder: (context, snapshot) {
        final session = snapshot.data?.session ?? Supabase.instance.client.auth.currentSession;
        if (session == null) {
          return const LoginPage();
        }

        final role = (session.user.userMetadata?['role'] as String?)?.toLowerCase();
        const postRoles = {'school', 'coach', 'athlete'};
        final canPost = role != null && postRoles.contains(role);

        final pages = <Widget>[
          const HomeFeedPage(),
          const HighlightsPage(),
          const ExplorerPage(),
          if (canPost) const CreatorProfilePage(),
        ];

        final destinations = <NavigationDestination>[
          const NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Home',
          ),
          const NavigationDestination(
            icon: Icon(Icons.play_circle_outline),
            selectedIcon: Icon(Icons.play_circle_fill),
            label: 'Highlights',
          ),
          const NavigationDestination(
            icon: Icon(Icons.explore_outlined),
            selectedIcon: Icon(Icons.explore),
            label: 'Explore',
          ),
          if (canPost)
            const NavigationDestination(
              icon: Icon(Icons.person_outline),
              selectedIcon: Icon(Icons.person),
              label: 'Profile',
            ),
        ];

        final safeIndex = _index.clamp(0, pages.length - 1);

        return Scaffold(
          body: pages[safeIndex],
          bottomNavigationBar: NavigationBarTheme(
            data: NavigationBarThemeData(
              backgroundColor: ClutchBrand.surfaceAlt,
              indicatorColor: ClutchBrand.ember.withOpacity(0.2),
              labelTextStyle: WidgetStateProperty.all(
                Theme.of(context).textTheme.labelLarge?.copyWith(color: ClutchBrand.frost),
              ),
            ),
            child: NavigationBar(
              selectedIndex: safeIndex,
              onDestinationSelected: (value) => setState(() => _index = value),
              destinations: destinations,
            ),
          ),
        );
      },
    );
  }
}
