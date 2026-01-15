import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../features/auth/login_page.dart';
import '../shared/clutched_background.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  static const _areaCodes = [
    _AreaCodeData('831', 'Santa Cruz / Watsonville', '282 athletes', 'Football', 'assets/images/football1.jpg'),
    _AreaCodeData('408', 'San Jose', '429 athletes', 'Basketball', 'assets/images/football2.jpg'),
    _AreaCodeData('415', 'San Francisco', '240 athletes', 'Soccer', 'assets/images/football3.jpg'),
    _AreaCodeData('510', 'East Bay', '386 athletes', 'Football', 'assets/images/football5.jpg'),
  ];

  static const _highlights = [
    _HighlightData('Diego Reyes', 'CB • Salinas', '19.3K views', 'assets/images/football2.jpg'),
    _HighlightData('Angel Sanchez', 'RB • North Salinas', '15.0K views', 'assets/images/football3.jpg'),
    _HighlightData('Noah Patterson', 'QB • Monterey', '9.9K views', 'assets/images/football1.jpg'),
    _HighlightData('Alyssa Cruz', 'PG • Santa Cruz', '11.7K views', 'assets/images/football5.jpg'),
  ];

  static const _bottomHighlights = [
    _HighlightData('Diego Reyes', 'CB • Salinas', '9.9K', 'assets/images/football1.jpg'),
    _HighlightData('Angel Sanchez', 'RB • North Salinas', '15.0K', 'assets/images/football2.jpg'),
    _HighlightData('Noah Patterson', 'QB • Monterey', '9.9K', 'assets/images/football3.jpg'),
    _HighlightData('Jayden Ross', 'FS • East Bay', '6.8K', 'assets/images/football5.jpg'),
  ];

  static const _mvpRunners = [
    _MvpData('Diego Reyes', 'CB', '4,671', 'assets/images/football1.jpg'),
    _MvpData('Angel Sanchez', 'RB', '4,529', 'assets/images/football2.jpg'),
    _MvpData('Alyssa Cruz', 'PG', '4,325', 'assets/images/football5.jpg'),
    _MvpData('Noah Patterson', 'QB', '4,192', 'assets/images/football3.jpg'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          const Positioned.fill(child: ClutchedBackground()),
          SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final isWide = constraints.maxWidth >= 900;
                return SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _HeaderBar(
                        onLogin: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const LoginPage()),
                          );
                        },
                      ),
                      const SizedBox(height: 24),
                      if (isWide)
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(
                              width: 260,
                              child: _AreaCodeColumn(cards: _areaCodes),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const _FeatureAthleteCard(),
                                  const SizedBox(height: 18),
                                  _HighlightsGrid(items: _highlights, columns: 2),
                                ],
                              ),
                            ),
                            const SizedBox(width: 16),
                            SizedBox(
                              width: 240,
                              child: _MvpPanel(items: _mvpRunners),
                            ),
                          ],
                        )
                      else
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const _FeatureAthleteCard(),
                            const SizedBox(height: 18),
                            _AreaCodeColumn(cards: _areaCodes),
                            const SizedBox(height: 18),
                            _HighlightsGrid(items: _highlights, columns: 2),
                            const SizedBox(height: 18),
                            _MvpPanel(items: _mvpRunners),
                          ],
                        ),
                      const SizedBox(height: 28),
                      const _SectionHeader(title: 'Highlights', trailing: 'See all'),
                      const SizedBox(height: 12),
                      SizedBox(
                        height: 190,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: _bottomHighlights.length,
                          separatorBuilder: (_, __) => const SizedBox(width: 12),
                          itemBuilder: (context, index) {
                            final item = _bottomHighlights[index];
                            return _HighlightCard(item: item, compact: true);
                          },
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _HeaderBar extends StatelessWidget {
  const _HeaderBar({required this.onLogin});

  final VoidCallback onLogin;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isWide = constraints.maxWidth >= 720;
        final title = const Text(
          'Clutched',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
        );
        final search = Expanded(
          child: Container(
            height: 44,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: const Color(0xFF1C1B21),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: const Color(0xFF2B2A31)),
            ),
            child: Row(
              children: [
                const Icon(Icons.search, size: 18, color: Color(0xFF8E8992)),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    style: const TextStyle(fontSize: 13),
                    decoration: const InputDecoration(
                      hintText: 'Search city // zip / area code (831, 408...)',
                      hintStyle: TextStyle(color: Color(0xFF8E8992)),
                      border: InputBorder.none,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
        final actions = StreamBuilder<User?>(
          stream: FirebaseAuth.instance.authStateChanges(),
          builder: (context, snapshot) {
            final user = snapshot.data;
            if (user == null) {
              return Container(
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFFB93A3A), Color(0xFF6F1F1F)],
                  ),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: TextButton(
                  onPressed: onLogin,
                  style: TextButton.styleFrom(
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                  ),
                  child: const Text('Log in / Sign up'),
                ),
              );
            }

            return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>( 
              future: FirebaseFirestore.instance.collection('users').doc(user.uid).get(),
              builder: (context, userSnapshot) {
                final data = userSnapshot.data?.data();
                final name = (data?['name'] as String?)?.trim();
                final displayName = (name != null && name.isNotEmpty)
                    ? name
                    : (user.email ?? 'Member');
                return GestureDetector(
                  onTap: () async {
                    await FirebaseAuth.instance.signOut();
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1C1B21),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0xFF2B2A31)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          displayName,
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(width: 8),
                        const Icon(Icons.logout, size: 16, color: Color(0xFFB8B3BB)),
                      ],
                    ),
                  ),
                );
              },
            );
          },
        );

        if (isWide) {
          return Row(
            children: [
              title,
              const SizedBox(width: 20),
              search,
              const SizedBox(width: 16),
              actions,
            ],
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            title,
            const SizedBox(height: 12),
            Row(
              children: [search, const SizedBox(width: 12), actions],
            ),
          ],
        );
      },
    );
  }
}

class _AreaCodeColumn extends StatelessWidget {
  const _AreaCodeColumn({required this.cards});

  final List<_AreaCodeData> cards;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionHeader(title: 'Area Code Talent', trailing: null),
        const SizedBox(height: 12),
        ...cards.map(
          (item) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _AreaCodeCard(data: item),
          ),
        ),
      ],
    );
  }
}

class _AreaCodeCard extends StatelessWidget {
  const _AreaCodeCard({required this.data});

  final _AreaCodeData data;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 110,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        color: const Color(0xFF1B1A20),
        border: Border.all(color: const Color(0xFF2C2B33)),
        boxShadow: const [
          BoxShadow(color: Color(0x66000000), blurRadius: 12, offset: Offset(0, 6)),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset(data.image, fit: BoxFit.cover),
            Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    const Color(0xFF15141A).withOpacity(0.9),
                    const Color(0xFF15141A).withOpacity(0.35),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    data.code,
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    data.location,
                    style: const TextStyle(fontSize: 12, color: Color(0xFFE3E1E5)),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '${data.athletes} • ${data.sport}',
                    style: const TextStyle(fontSize: 11, color: Color(0xFFB8B3BB)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeatureAthleteCard extends StatelessWidget {
  const _FeatureAthleteCard();

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isCompact = constraints.maxWidth < 420;
        final padding = isCompact ? 14.0 : 18.0;
        final titleSize = isCompact ? 14.0 : 16.0;
        final nameSize = isCompact ? 18.0 : 20.0;
        final subSize = isCompact ? 11.0 : 12.0;
        final statSpacing = isCompact ? 10.0 : 16.0;
        final height = (constraints.maxWidth * 0.65).clamp(260.0, 320.0);

        return SizedBox(
          height: height,
          child: Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        color: const Color(0xFF1B1A20),
        border: Border.all(color: const Color(0xFF2C2B33)),
        boxShadow: const [
          BoxShadow(color: Color(0x66000000), blurRadius: 14, offset: Offset(0, 8)),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset('assets/images/football5.jpg', fit: BoxFit.cover),
            Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [
                    const Color(0xFF17161C).withOpacity(0.95),
                    const Color(0xFF17161C).withOpacity(0.35),
                  ],
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.all(padding),
              child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Top Athlete in the Nation',
                        style: TextStyle(fontSize: titleSize, fontWeight: FontWeight.w600),
                      ),
                      if (!isCompact) const Spacer(),
                      Row(
                        children: const [
                          CircleAvatar(
                            radius: 14,
                            backgroundColor: Color(0xFF26242B),
                            child: Icon(Icons.star, size: 14, color: Color(0xFFE3B341)),
                          ),
                          SizedBox(width: 10),
                          Text('James Miller', style: TextStyle(fontWeight: FontWeight.w600)),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'James Miller',
                        style: TextStyle(fontSize: nameSize, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'WR • Class of 2027',
                        style: TextStyle(fontSize: subSize, color: const Color(0xFFB8B3BB)),
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: statSpacing,
                        runSpacing: 8,
                        children: const [
                          _StatPill(label: 'Watsonville HS'),
                          _StatPill(label: '4,981', subLabel: '26 TDs'),
                          _StatPill(label: '4.52"', subLabel: '40 yd'),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 12,
                        children: [
                          _ActionChip(
                            label: 'View Profile',
                            filled: true,
                            onTap: () {},
                          ),
                          _ActionChip(
                            label: 'Watch Highlights',
                            filled: false,
                            onTap: () {},
                          ),
                        ],
                      ),
                    ],
                  ),
            ),
          ],
        ),
      ),
          ),
        );
      },
    );
  }
}

class _HighlightsGrid extends StatelessWidget {
  const _HighlightsGrid({required this.items, required this.columns});

  final List<_HighlightData> items;
  final int columns;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isNarrow = constraints.maxWidth < 420;
        final aspect = columns == 2
            ? (isNarrow ? 0.9 : 0.98)
            : 1.1;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const _SectionHeader(title: 'Highlights', trailing: 'MVP Runner-Ups'),
            const SizedBox(height: 12),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: items.length,
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: columns,
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: aspect,
              ),
              itemBuilder: (context, index) => _HighlightCard(item: items[index]),
            ),
          ],
        );
      },
    );
  }
}

class _HighlightCard extends StatelessWidget {
  const _HighlightCard({required this.item, this.compact = false});

  final _HighlightData item;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final cardWidth = compact ? 180.0 : double.infinity;
    final imageRatio = compact ? 0.45 : 0.55;
    final contentPadding = compact ? 10.0 : 12.0;
    final nameSize = compact ? 12.0 : 14.0;
    final metaSize = compact ? 10.0 : 11.0;
    return SizedBox(
      width: cardWidth,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final imageHeight = constraints.hasBoundedHeight
              ? constraints.maxHeight * imageRatio
              : (compact ? 90.0 : 120.0);
          return Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              color: const Color(0xFF1B1A20),
              border: Border.all(color: const Color(0xFF2C2B33)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipRRect(
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
                  child: SizedBox(
                    height: imageHeight,
                    width: double.infinity,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        Image.asset(item.image, fit: BoxFit.cover),
                        Positioned(
                          left: 10,
                          bottom: 10,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: const Color(0xFF1B1A20).withOpacity(0.8),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Row(
                              children: const [
                                Icon(Icons.play_arrow, size: 12, color: Color(0xFFB8B3BB)),
                                SizedBox(width: 4),
                                Text('9', style: TextStyle(fontSize: 10, color: Color(0xFFB8B3BB))),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.all(contentPadding),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        SizedBox(
                          width: double.infinity,
                          child: Text(
                            item.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: nameSize,
                            ),
                          ),
                        ),
                        const SizedBox(height: 3),
                        SizedBox(
                          width: double.infinity,
                          child: Text(
                            item.position,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: metaSize, color: const Color(0xFFB8B3BB)),
                          ),
                        ),
                        const SizedBox(height: 4),
                        SizedBox(
                          width: double.infinity,
                          child: Text(
                            item.views,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: metaSize, color: const Color(0xFF8D8891)),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _MvpPanel extends StatelessWidget {
  const _MvpPanel({required this.items});

  final List<_MvpData> items;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        color: const Color(0xFF1B1A20),
        border: Border.all(color: const Color(0xFF2C2B33)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionHeader(title: 'MVP Runner-Ups', trailing: null),
          const SizedBox(height: 12),
          ...items.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundImage: AssetImage(item.avatar),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                        const SizedBox(height: 2),
                        Text(item.position, style: const TextStyle(fontSize: 11, color: Color(0xFFB8B3BB))),
                      ],
                    ),
                  ),
                  Text(item.score, style: const TextStyle(fontWeight: FontWeight.w600)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.trailing});

  final String title;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        if (trailing != null)
          Text(
            trailing!,
            style: const TextStyle(fontSize: 12, color: Color(0xFFB8B3BB)),
          ),
      ],
    );
  }
}

class _ActionChip extends StatelessWidget {
  const _ActionChip({required this.label, required this.filled, required this.onTap});

  final String label;
  final bool filled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: filled ? const Color(0xFF2C4B8C) : const Color(0xFF1B1A20),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFF2C2B33)),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: filled ? Colors.white : const Color(0xFFB8B3BB),
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _StatPill extends StatelessWidget {
  const _StatPill({required this.label, this.subLabel});

  final String label;
  final String? subLabel;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1C23),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF2C2B33)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
          if (subLabel != null)
            Text(subLabel!, style: const TextStyle(fontSize: 10, color: Color(0xFFB8B3BB))),
        ],
      ),
    );
  }
}

class _AreaCodeData {
  const _AreaCodeData(this.code, this.location, this.athletes, this.sport, this.image);

  final String code;
  final String location;
  final String athletes;
  final String sport;
  final String image;
}

class _HighlightData {
  const _HighlightData(this.name, this.position, this.views, this.image);

  final String name;
  final String position;
  final String views;
  final String image;
}

class _MvpData {
  const _MvpData(this.name, this.position, this.score, this.avatar);

  final String name;
  final String position;
  final String score;
  final String avatar;
}
