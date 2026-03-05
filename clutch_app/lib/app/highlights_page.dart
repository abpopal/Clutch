import 'package:flutter/material.dart';

import '../shared/clutched_background.dart';
import 'brand.dart';

class HighlightsPage extends StatelessWidget {
  const HighlightsPage({super.key});

  static const List<_HighlightItem> _highlights = [
    _HighlightItem('North Valley HS', 'Goal of the week', 'assets/images/football1.jpg', '12.4K views'),
    _HighlightItem('East Bay High', 'Friday night recap', 'assets/images/football5.jpg', '9.8K views'),
    _HighlightItem('Monterey Prep', 'Defense lock', 'assets/images/football2.jpg', '8.1K views'),
    _HighlightItem('Santa Cruz Prep', 'Overtime winner', 'assets/images/football3.jpg', '7.2K views'),
  ];

  static const List<_ReelItem> _reels = [
    _ReelItem('Game Night', 'Rivalry kickoff reel', 'assets/images/football5.jpg', '2:18'),
    _ReelItem('Coach Chalk', 'Two-minute breakdown', 'assets/images/football2.jpg', '1:42'),
    _ReelItem('Athlete Diary', 'Weekend tournament', 'assets/images/football3.jpg', '2:04'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          const Positioned.fill(child: ClutchedBackground()),
          SafeArea(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
              children: const [
                _Header(),
                SizedBox(height: 18),
                _HighlightStrip(),
                SizedBox(height: 18),
                _ReelGrid(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Row(
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Highlights', style: textTheme.titleLarge?.copyWith(letterSpacing: 1.2)),
            const SizedBox(height: 4),
            Text(
              'Top reels, weekly moments, and spotlight plays',
              style: textTheme.bodyMedium?.copyWith(color: ClutchBrand.frost.withOpacity(0.7)),
            ),
          ],
        ),
        const Spacer(),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: ClutchBrand.surfaceAlt,
            borderRadius: ClutchBrand.chipRadius,
            border: Border.all(color: ClutchBrand.line),
          ),
          child: Row(
            children: [
              const Icon(Icons.play_circle_fill, size: 16, color: ClutchBrand.frost),
              const SizedBox(width: 8),
              Text('Reel Mode', style: textTheme.labelLarge),
            ],
          ),
        ),
      ],
    );
  }
}

class _HighlightStrip extends StatelessWidget {
  const _HighlightStrip();

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Highlight Reel', style: textTheme.titleMedium),
        const SizedBox(height: 10),
        SizedBox(
          height: 180,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: HighlightsPage._highlights.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) => _HighlightCard(item: HighlightsPage._highlights[index]),
          ),
        ),
      ],
    );
  }
}

class _HighlightItem {
  const _HighlightItem(this.school, this.title, this.image, this.meta);

  final String school;
  final String title;
  final String image;
  final String meta;
}

class _HighlightCard extends StatelessWidget {
  const _HighlightCard({required this.item});

  final _HighlightItem item;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      width: 240,
      decoration: BoxDecoration(
        borderRadius: ClutchBrand.cardRadius,
        image: DecorationImage(
          image: AssetImage(item.image),
          fit: BoxFit.cover,
        ),
      ),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          borderRadius: ClutchBrand.cardRadius,
          gradient: LinearGradient(
            colors: [
              ClutchBrand.ink.withOpacity(0.0),
              ClutchBrand.ink.withOpacity(0.75),
            ],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: ClutchBrand.ink.withOpacity(0.6),
                borderRadius: ClutchBrand.chipRadius,
              ),
              child: Text(item.meta, style: textTheme.labelLarge),
            ),
            const Spacer(),
            Text(item.school, style: textTheme.labelLarge?.copyWith(color: ClutchBrand.gold)),
            const SizedBox(height: 4),
            Text(item.title, style: textTheme.titleMedium),
          ],
        ),
      ),
    );
  }
}

class _ReelItem {
  const _ReelItem(this.title, this.subtitle, this.image, this.duration);

  final String title;
  final String subtitle;
  final String image;
  final String duration;
}

class _ReelGrid extends StatelessWidget {
  const _ReelGrid();

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Top Reels', style: textTheme.titleMedium),
        const SizedBox(height: 10),
        LayoutBuilder(
          builder: (context, constraints) {
            final isWide = constraints.maxWidth >= 520;
            final crossAxisCount = isWide ? 2 : 1;
            return GridView.count(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisCount: crossAxisCount,
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: 1.3,
              children: HighlightsPage._reels
                  .map((item) => _ReelCard(item: item))
                  .toList(),
            );
          },
        ),
      ],
    );
  }
}

class _ReelCard extends StatelessWidget {
  const _ReelCard({required this.item});

  final _ReelItem item;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      decoration: BoxDecoration(
        borderRadius: ClutchBrand.cardRadius,
        image: DecorationImage(
          image: AssetImage(item.image),
          fit: BoxFit.cover,
        ),
      ),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          borderRadius: ClutchBrand.cardRadius,
          gradient: LinearGradient(
            colors: [
              ClutchBrand.ink.withOpacity(0.0),
              ClutchBrand.ink.withOpacity(0.8),
            ],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Align(
              alignment: Alignment.topRight,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: ClutchBrand.surfaceAlt.withOpacity(0.8),
                  borderRadius: ClutchBrand.chipRadius,
                ),
                child: Text(item.duration, style: textTheme.labelLarge),
              ),
            ),
            const Spacer(),
            Text(item.title, style: textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(
              item.subtitle,
              style: textTheme.bodyMedium?.copyWith(color: ClutchBrand.frost.withOpacity(0.7)),
            ),
          ],
        ),
      ),
    );
  }
}
