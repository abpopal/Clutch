import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../shared/clutched_background.dart';
import 'brand.dart';

class CreatorProfilePage extends StatelessWidget {
  const CreatorProfilePage({super.key});

  static const List<String> _fallbackImages = [
    'assets/images/football1.jpg',
    'assets/images/football2.jpg',
    'assets/images/football3.jpg',
    'assets/images/football5.jpg',
  ];

  @override
  Widget build(BuildContext context) {
    final user = Supabase.instance.client.auth.currentUser;
    final name = (user?.userMetadata?['name'] as String?)?.trim();
    final displayName = (name != null && name.isNotEmpty) ? name : (user?.email ?? 'Member');
    final role = (user?.userMetadata?['role'] as String?)?.toUpperCase() ?? 'CREATOR';

    return Scaffold(
      body: Stack(
        children: [
          const Positioned.fill(child: ClutchedBackground()),
          SafeArea(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
              children: [
                Text('Your Profile', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    gradient: ClutchBrand.panelGradient,
                    borderRadius: ClutchBrand.cardRadius,
                    border: Border.all(color: ClutchBrand.line),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 54,
                        height: 54,
                        decoration: BoxDecoration(
                          color: ClutchBrand.surfaceAlt,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: ClutchBrand.line),
                        ),
                        child: const Icon(Icons.sports_soccer, color: ClutchBrand.frost),
                      ),
                      const SizedBox(width: 14),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(displayName, style: Theme.of(context).textTheme.titleMedium),
                          const SizedBox(height: 4),
                          Text(
                            role,
                            style: Theme.of(context)
                                .textTheme
                                .labelLarge
                                ?.copyWith(color: ClutchBrand.gold),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                FutureBuilder<_ProfileStats>(
                  future: _loadStats(),
                  builder: (context, snapshot) {
                    final stats = snapshot.data ?? const _ProfileStats(posts: 0, followers: 0, following: 0);
                    return _StatsRow(stats: stats);
                  },
                ),
                const SizedBox(height: 18),
                Text('Your Posts', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 12),
                FutureBuilder<List<_UserPost>>(
                  future: _loadUserPosts(),
                  builder: (context, snapshot) {
                    final posts = snapshot.data ?? [];
                    if (snapshot.connectionState == ConnectionState.waiting) {
                      return const Center(child: CircularProgressIndicator());
                    }
                    if (posts.isEmpty) {
                      return Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: ClutchBrand.surfaceAlt,
                          borderRadius: ClutchBrand.cardRadius,
                          border: Border.all(color: ClutchBrand.line),
                        ),
                        child: const Text('No posts yet.'),
                      );
                    }
                    return LayoutBuilder(
                      builder: (context, constraints) {
                        final crossAxisCount = constraints.maxWidth >= 520 ? 2 : 1;
                        return GridView.count(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          crossAxisCount: crossAxisCount,
                          crossAxisSpacing: 12,
                          mainAxisSpacing: 12,
                          childAspectRatio: 1.35,
                          children: posts
                              .map((post) => _PostTile(image: post.image, caption: post.caption))
                              .toList(),
                        );
                      },
                    );
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

Future<_ProfileStats> _loadStats() async {
  final client = Supabase.instance.client;
  final authUser = client.auth.currentUser;
  if (authUser == null) {
    return const _ProfileStats(posts: 0, followers: 0, following: 0);
  }

  final userRow = await client
      .from('users')
      .select('user_id')
      .eq('firebase_uid', authUser.id)
      .single();
  final userId = userRow['user_id'] as String;

  final posts = await client.from('post').select('post_id').eq('author_user_id', userId);
  final followers = await client.from('follow').select('follower_user_id').eq('followed_user_id', userId);
  final following = await client.from('follow').select('followed_user_id').eq('follower_user_id', userId);

  return _ProfileStats(
    posts: posts.length,
    followers: followers.length,
    following: following.length,
  );
}

class _ProfileStats {
  const _ProfileStats({required this.posts, required this.followers, required this.following});

  final int posts;
  final int followers;
  final int following;
}

class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.stats});

  final _ProfileStats stats;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Row(
      children: [
        Expanded(child: _StatCard(label: 'Posts', value: '${stats.posts}')),
        const SizedBox(width: 12),
        Expanded(child: _StatCard(label: 'Followers', value: '${stats.followers}')),
        const SizedBox(width: 12),
        Expanded(child: _StatCard(label: 'Following', value: '${stats.following}')),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: BoxDecoration(
        color: ClutchBrand.surfaceAlt,
        borderRadius: ClutchBrand.cardRadius,
        border: Border.all(color: ClutchBrand.line),
      ),
      child: Column(
        children: [
          Text(value, style: textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(label, style: textTheme.labelLarge?.copyWith(color: ClutchBrand.frost.withOpacity(0.7))),
        ],
      ),
    );
  }
}

Future<List<_UserPost>> _loadUserPosts() async {
  final client = Supabase.instance.client;
  final authUser = client.auth.currentUser;
  if (authUser == null) {
    return [];
  }

  final userRow = await client
      .from('users')
      .select('user_id')
      .eq('firebase_uid', authUser.id)
      .single();
  final userId = userRow['user_id'] as String;

  final response = await client
      .from('post')
      .select('post_id, caption, post_media (media_url, media_type)')
      .eq('author_user_id', userId)
      .order('created_at', ascending: false);

  return response.asMap().entries.map((entry) {
    final data = entry.value as Map<String, dynamic>;
    return _UserPost.fromMap(data, entry.key);
  }).toList();
}

class _UserPost {
  const _UserPost({required this.image, required this.caption});

  final String image;
  final String caption;

  factory _UserPost.fromMap(Map<String, dynamic> data, int index) {
    final caption = (data['caption'] as String?) ?? '';
    final mediaList = (data['post_media'] as List?) ?? const [];
    final mediaItem = mediaList.isNotEmpty ? (mediaList.first as Map<String, dynamic>?) : null;
    final mediaUrl = mediaItem?['media_url'] as String?;
    final fallbackImage =
        CreatorProfilePage._fallbackImages[index % CreatorProfilePage._fallbackImages.length];

    return _UserPost(
      image: mediaUrl ?? fallbackImage,
      caption: caption,
    );
  }
}

class _PostTile extends StatelessWidget {
  const _PostTile({required this.image, required this.caption});

  final String image;
  final String caption;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      decoration: BoxDecoration(
        borderRadius: ClutchBrand.cardRadius,
        image: DecorationImage(image: _imageProvider(image), fit: BoxFit.cover),
      ),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: ClutchBrand.cardRadius,
          gradient: LinearGradient(
            colors: [
              ClutchBrand.ink.withOpacity(0.0),
              ClutchBrand.ink.withOpacity(0.6),
            ],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: Align(
          alignment: Alignment.bottomLeft,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Text(
              caption.isEmpty ? 'Post' : caption,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: textTheme.labelLarge,
            ),
          ),
        ),
      ),
    );
  }

  ImageProvider _imageProvider(String path) {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return NetworkImage(path);
    }
    return AssetImage(path);
  }
}
