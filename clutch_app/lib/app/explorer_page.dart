import 'package:flutter/material.dart';

import '../shared/clutched_background.dart';
import 'brand.dart';

class ExplorerPage extends StatelessWidget {
  const ExplorerPage({super.key});
  static const List<_MvpItem> _mvps = [
    _MvpItem('Alyssa Cruz', 'PG • Santa Cruz', '4,671 votes'),
    _MvpItem('Diego Reyes', 'CB • Salinas', '4,529 votes'),
    _MvpItem('Jayden Ross', 'SF • East Bay', '4,325 votes'),
  ];

  static const List<_NewsItem> _news = [
    _NewsItem('League realignment announced', 'New schedules drop Monday.'),
    _NewsItem('Top 10 programs ranked', 'Early season power list updated.'),
    _NewsItem('Coach clinic weekend', 'Signups open for position groups.'),
  ];

  static const List<_HotPost> _hotPosts = [
    _HotPost('Coach Serrano', 'Film breakdown clip', 'assets/images/football2.jpg', '1.2K saves'),
    _HotPost('Alyssa Cruz', 'Weekend tournament', 'assets/images/football3.jpg', '940 comments'),
    _HotPost('North Valley HS', 'Rivalry win', 'assets/images/football1.jpg', '5.8K reactions'),
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
                _MvpPanel(),
                SizedBox(height: 18),
                _TopNews(),
                SizedBox(height: 18),
                _HotPosts(),
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
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: ClutchBrand.panelGradient,
        borderRadius: ClutchBrand.cardRadius,
        border: Border.all(color: ClutchBrand.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('Explore', style: textTheme.titleLarge?.copyWith(letterSpacing: 1.2)),
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
                    const Icon(Icons.trending_up, size: 16, color: ClutchBrand.frost),
                    const SizedBox(width: 8),
                    Text('Trending', style: textTheme.labelLarge),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'Highlights, MVPs, top news, and most interacted posts',
            style: textTheme.bodyMedium?.copyWith(color: ClutchBrand.frost.withOpacity(0.7)),
          ),
          const SizedBox(height: 14),
          Container(
            height: 48,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: ClutchBrand.surfaceAlt,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: ClutchBrand.line),
            ),
            child: Row(
              children: [
                const Icon(Icons.search, size: 18, color: ClutchBrand.frost),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    style: textTheme.bodyMedium,
                    decoration: InputDecoration(
                      hintText: 'Search teams, players, leagues',
                      hintStyle: textTheme.bodyMedium?.copyWith(
                        color: ClutchBrand.frost.withOpacity(0.6),
                      ),
                      border: InputBorder.none,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: ClutchBrand.surface,
                    borderRadius: ClutchBrand.chipRadius,
                  ),
                  child: Text('Filter', style: textTheme.labelLarge),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}


class _MvpPanel extends StatelessWidget {
  const _MvpPanel();

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: ClutchBrand.panelGradient,
        borderRadius: ClutchBrand.cardRadius,
        border: Border.all(color: ClutchBrand.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('MVP Ladder', style: textTheme.titleMedium),
          const SizedBox(height: 10),
          Column(
            children: ExplorerPage._mvps
                .asMap()
                .entries
                .map(
                  (entry) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _MvpRow(rank: entry.key + 1, item: entry.value),
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }
}

class _MvpItem {
  const _MvpItem(this.name, this.detail, this.votes);

  final String name;
  final String detail;
  final String votes;
}

class _MvpRow extends StatelessWidget {
  const _MvpRow({required this.rank, required this.item});

  final int rank;
  final _MvpItem item;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Row(
      children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: ClutchBrand.ember.withOpacity(0.2),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Center(
            child: Text('#$rank', style: textTheme.labelLarge?.copyWith(color: ClutchBrand.ember)),
          ),
        ),
        const SizedBox(width: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(item.name, style: textTheme.bodyLarge),
            const SizedBox(height: 2),
            Text(item.detail, style: textTheme.bodyMedium?.copyWith(color: ClutchBrand.frost.withOpacity(0.7))),
          ],
        ),
        const Spacer(),
        Text(item.votes, style: textTheme.labelLarge),
      ],
    );
  }
}

class _TopNews extends StatelessWidget {
  const _TopNews();

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ClutchBrand.surfaceAlt,
        borderRadius: ClutchBrand.cardRadius,
        border: Border.all(color: ClutchBrand.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Top News', style: textTheme.titleMedium),
          const SizedBox(height: 10),
          Column(
            children: ExplorerPage._news
                .map(
                  (item) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 6,
                          height: 6,
                          margin: const EdgeInsets.only(top: 6),
                          decoration: const BoxDecoration(
                            color: ClutchBrand.gold,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(item.title, style: textTheme.bodyLarge),
                              const SizedBox(height: 4),
                              Text(
                                item.subtitle,
                                style: textTheme.bodyMedium?.copyWith(
                                  color: ClutchBrand.frost.withOpacity(0.7),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }
}

class _NewsItem {
  const _NewsItem(this.title, this.subtitle);

  final String title;
  final String subtitle;
}

class _HotPosts extends StatelessWidget {
  const _HotPosts();

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Most Interactions', style: textTheme.titleMedium),
        const SizedBox(height: 10),
        Column(
          children: ExplorerPage._hotPosts
              .map(
                (post) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _HotPostCard(item: post),
                ),
              )
              .toList(),
        ),
      ],
    );
  }
}

class _HotPost {
  const _HotPost(this.author, this.title, this.image, this.meta);

  final String author;
  final String title;
  final String image;
  final String meta;
}

class _HotPostCard extends StatelessWidget {
  const _HotPostCard({required this.item});

  final _HotPost item;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      decoration: BoxDecoration(
        color: ClutchBrand.surfaceAlt,
        borderRadius: ClutchBrand.cardRadius,
        border: Border.all(color: ClutchBrand.line),
      ),
      child: Row(
        children: [
          Container(
            width: 96,
            height: 96,
            decoration: BoxDecoration(
              borderRadius: const BorderRadius.horizontal(left: Radius.circular(20)),
              image: DecorationImage(image: AssetImage(item.image), fit: BoxFit.cover),
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.author, style: textTheme.labelLarge?.copyWith(color: ClutchBrand.gold)),
                  const SizedBox(height: 6),
                  Text(item.title, style: textTheme.bodyLarge),
                  const SizedBox(height: 6),
                  Text(
                    item.meta,
                    style: textTheme.bodyMedium?.copyWith(color: ClutchBrand.frost.withOpacity(0.6)),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
