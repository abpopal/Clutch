import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../shared/clutched_background.dart';
import '../features/auth/login_page.dart';
import 'brand.dart';
import 'post_compose_page.dart';

class HomeFeedPage extends StatelessWidget {
  const HomeFeedPage({super.key});

  static const List<_PulseItem> _pulse = [
    _PulseItem('Game Night', 'North Valley vs Seaside', '7:00 PM', ClutchBrand.ember),
    _PulseItem('Coach Chalk', 'Press break setup', 'Clip', ClutchBrand.gold),
    _PulseItem('Athlete Streak', 'Jayden Ross 24 pts', 'Hot', ClutchBrand.mint),
    _PulseItem('League Drop', 'New standings posted', 'Update', ClutchBrand.ember),
  ];

  static const List<String> _fallbackImages = [
    'assets/images/football5.jpg',
    'assets/images/football2.jpg',
    'assets/images/football3.jpg',
    'assets/images/football1.jpg',
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
                _HeaderBar(),
                SizedBox(height: 18),
                _RoleFilters(),
                SizedBox(height: 18),
                _PulseStrip(),
                SizedBox(height: 18),
                _ComposerCard(),
                SizedBox(height: 14),
                _FeedList(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeaderBar extends StatelessWidget {
  const _HeaderBar();

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final actions = StreamBuilder<AuthState>(
      stream: Supabase.instance.client.auth.onAuthStateChange,
      builder: (context, snapshot) {
        final user = snapshot.data?.session?.user ?? Supabase.instance.client.auth.currentUser;
        if (user == null) {
          return _UserPill(
            label: 'Log in',
            icon: Icons.lock_outline,
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const LoginPage()),
              );
            },
          );
        }

        final name = (user.userMetadata?['name'] as String?)?.trim();
        final displayName = (name != null && name.isNotEmpty)
            ? name
            : (user.email ?? 'Member');
        final role = (user.userMetadata?['role'] as String?)?.toLowerCase();
        const postRoles = {'school', 'coach', 'athlete'};
        final canPost = role != null && postRoles.contains(role);
        return _UserPill(
          label: displayName,
          icon: Icons.verified,
          onTap: () => _showLogoutSheet(context),
          leading: canPost
              ? _ActionPill(
                  icon: Icons.add,
                  label: 'Post',
                  onTap: () => _pickFromGallery(context),
                )
              : null,
        );
      },
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        final isWide = constraints.maxWidth >= 700;

        final stats = Wrap(
          spacing: 8,
          runSpacing: 8,
          children: const [
            _HeaderChip(label: 'Highlights'),
            _HeaderChip(label: 'Teams'),
            _HeaderChip(label: 'Leagues'),
          ],
        );

        return Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            gradient: ClutchBrand.panelGradient,
            borderRadius: ClutchBrand.cardRadius,
            border: Border.all(color: ClutchBrand.line),
          ),
          child: Column(
            children: [
              Row(
                children: [
                  Text(
                    ClutchBrand.appName,
                    style: textTheme.titleLarge?.copyWith(letterSpacing: 1.6),
                  ),
                  const Spacer(),
                  if (isWide) actions,
                ],
              ),
              if (!isWide) ...[
                const SizedBox(height: 10),
                Align(alignment: Alignment.centerRight, child: actions),
              ],
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerLeft,
                child: stats,
              ),
            ],
          ),
        );
      },
    );
  }
}

Future<void> _pickFromGallery(BuildContext context) async {
  final picker = ImagePicker();
  final file = await picker.pickImage(source: ImageSource.gallery);
  if (file == null) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No media selected.')),
      );
    }
    return;
  }
  if (context.mounted) {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => PostComposePage(image: file)),
    );
  }
}

Future<void> _showLogoutSheet(BuildContext context) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    backgroundColor: ClutchBrand.surfaceAlt,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (context) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 48,
                height: 4,
                decoration: BoxDecoration(
                  color: ClutchBrand.line,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
              const SizedBox(height: 16),
              ListTile(
                leading: const Icon(Icons.logout, color: ClutchBrand.frost),
                title: const Text('Log out'),
                onTap: () => Navigator.of(context).pop(true),
              ),
            ],
          ),
        ),
      );
    },
  );

  if (result == true) {
    await Supabase.instance.client.auth.signOut();
  }
}

class _UserPill extends StatelessWidget {
  const _UserPill({
    required this.label,
    required this.icon,
    required this.onTap,
    this.leading,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (leading != null) ...[
          leading!,
          const SizedBox(width: 10),
        ],
        GestureDetector(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              gradient: ClutchBrand.emberGradient,
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(
                  color: ClutchBrand.ember.withOpacity(0.35),
                  blurRadius: 12,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 16, color: ClutchBrand.frost),
                const SizedBox(width: 8),
                Text(label, style: textTheme.labelLarge?.copyWith(color: ClutchBrand.frost)),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _HeaderChip extends StatelessWidget {
  const _HeaderChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: ClutchBrand.surfaceAlt,
        borderRadius: ClutchBrand.chipRadius,
        border: Border.all(color: ClutchBrand.line),
      ),
      child: Text(label, style: textTheme.labelLarge),
    );
  }
}

class _ActionPill extends StatelessWidget {
  const _ActionPill({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: ClutchBrand.surfaceAlt,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: ClutchBrand.line),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: ClutchBrand.frost),
            const SizedBox(width: 6),
            Text(label, style: textTheme.labelLarge),
          ],
        ),
      ),
    );
  }
}

class _RoleFilters extends StatelessWidget {
  const _RoleFilters();

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: const [
        _FilterChip(icon: Icons.school, label: 'Schools'),
        _FilterChip(icon: Icons.sports, label: 'Coaches'),
        _FilterChip(icon: Icons.bolt, label: 'Athletes'),
        _FilterChip(icon: Icons.star, label: 'Top Moments'),
      ],
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: ClutchBrand.surfaceAlt,
        borderRadius: ClutchBrand.chipRadius,
        border: Border.all(color: ClutchBrand.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: ClutchBrand.frost),
          const SizedBox(width: 8),
          Text(label, style: textTheme.labelLarge),
        ],
      ),
    );
  }
}

class _PulseStrip extends StatelessWidget {
  const _PulseStrip();

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Pulse', style: textTheme.titleMedium),
        const SizedBox(height: 10),
        SizedBox(
          height: 118,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: HomeFeedPage._pulse.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) => _PulseCard(item: HomeFeedPage._pulse[index]),
          ),
        ),
      ],
    );
  }
}

class _PulseItem {
  const _PulseItem(this.title, this.subtitle, this.meta, this.accent);

  final String title;
  final String subtitle;
  final String meta;
  final Color accent;
}

class _PulseCard extends StatelessWidget {
  const _PulseCard({required this.item});

  final _PulseItem item;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      width: 210,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: ClutchBrand.cardRadius,
        gradient: ClutchBrand.panelGradient,
        border: Border.all(color: ClutchBrand.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(color: item.accent, shape: BoxShape.circle),
              ),
              const SizedBox(width: 8),
              Text(item.meta, style: textTheme.labelLarge?.copyWith(color: item.accent)),
            ],
          ),
          const SizedBox(height: 10),
          Text(item.title, style: textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(
            item.subtitle,
            style: textTheme.bodyMedium?.copyWith(color: ClutchBrand.frost.withOpacity(0.7)),
          ),
        ],
      ),
    );
  }
}

class _ComposerCard extends StatelessWidget {
  const _ComposerCard();

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
          Text('Share something for your squad', style: textTheme.titleMedium),
          const SizedBox(height: 10),
          Text(
            'Schools, coaches, and athletes can post image, video, or text. Fans only follow.',
            style: textTheme.bodyMedium?.copyWith(color: ClutchBrand.frost.withOpacity(0.7)),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: const [
              _ComposerAction(icon: Icons.image, label: 'Image'),
              _ComposerAction(icon: Icons.videocam, label: 'Video'),
              _ComposerAction(icon: Icons.text_fields, label: 'Text'),
            ],
          ),
        ],
      ),
    );
  }
}

class _ComposerAction extends StatelessWidget {
  const _ComposerAction({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: ClutchBrand.surface,
        borderRadius: ClutchBrand.chipRadius,
        border: Border.all(color: ClutchBrand.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: ClutchBrand.frost),
          const SizedBox(width: 8),
          Text(label, style: textTheme.labelLarge),
        ],
      ),
    );
  }
}

class _FeedList extends StatefulWidget {
  const _FeedList();

  @override
  State<_FeedList> createState() => _FeedListState();
}

class _FeedListState extends State<_FeedList> {
  bool _loading = true;
  String? _userId;
  List<_FeedPost> _posts = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final posts = await _loadPosts();
    final userId = await _loadUserId();
    if (mounted) {
      setState(() {
        _posts = posts;
        _userId = userId;
        _loading = false;
      });
    }
  }

  Future<String?> _loadUserId() async {
    final client = Supabase.instance.client;
    final authUser = client.auth.currentUser;
    if (authUser == null) {
      return null;
    }
    final roleValue = (authUser.userMetadata?['role'] as String?)?.toLowerCase() ?? 'athlete';
    final existingUser = await client
        .from('users')
        .select('user_id')
        .eq('firebase_uid', authUser.id)
        .maybeSingle();
    if (existingUser != null) {
      return existingUser['user_id'] as String;
    }
    final inserted = await client
        .from('users')
        .insert({'firebase_uid': authUser.id, 'role': roleValue})
        .select('user_id')
        .single();
    return inserted['user_id'] as String;
  }

  Future<List<_FeedPost>> _loadPosts() async {
    final client = Supabase.instance.client;
    final response = await client
        .from('post')
        .select(
          'post_id, caption, post_type, created_at, visibility, author_role, interactions_count, post_media (media_url, media_type)',
        )
        .order('created_at', ascending: false);

    return response.asMap().entries.map((entry) {
      final data = entry.value as Map<String, dynamic>;
      return _FeedPost.fromMap(data, entry.key);
    }).toList();
  }

  Future<void> _registerInteraction(_FeedPost post) async {
    final userId = _userId;
    if (userId == null || post.postId.isEmpty) {
      return;
    }
    try {
      final client = Supabase.instance.client;

      await client.from('post_interaction').upsert(
        {
          'post_id': post.postId,
          'user_id': userId,
        },
        onConflict: 'post_id,user_id',
      );

      final countResp = await client
          .from('post_interaction')
          .select('interaction_id')
          .eq('post_id', post.postId);
      final newCount = (countResp as List).length;

      await client.from('post').update({'interactions_count': newCount}).eq('post_id', post.postId);

      if (mounted) {
        setState(() {
          _posts = _posts
              .map((item) => item.postId == post.postId
                  ? item.copyWith(interactionsCount: newCount)
                  : item)
              .toList();
        });
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not record interaction: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_posts.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: ClutchBrand.surfaceAlt,
          borderRadius: ClutchBrand.cardRadius,
          border: Border.all(color: ClutchBrand.line),
        ),
        child: const Text('No posts yet.'),
      );
    }
    return Column(
      children: _posts
          .map((post) => Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: _FeedCard(
                  post: post,
                  onInteract: () => _registerInteraction(post),
                ),
              ))
          .toList(),
    );
  }
}

class _FeedPost {
  const _FeedPost({
    required this.postId,
    required this.author,
    required this.role,
    required this.title,
    required this.body,
    required this.image,
    required this.meta,
    required this.accent,
    required this.mediaType,
    required this.interactionsCount,
  });

  final String postId;
  final String author;
  final String role;
  final String title;
  final String body;
  final String image;
  final String meta;
  final Color accent;
  final String mediaType;
  final int interactionsCount;

  factory _FeedPost.fromMap(Map<String, dynamic> data, int index) {
    final postType = (data['post_type'] as String?) ?? 'text';
    final role = (data['author_role'] as String?) ?? 'athlete';
    final caption = (data['caption'] as String?) ?? '';
    final mediaList = (data['post_media'] as List?) ?? const [];
    final mediaItem = mediaList.isNotEmpty ? (mediaList.first as Map<String, dynamic>?) : null;
    final mediaUrl = mediaItem?['media_url'] as String?;
    final fallbackImage = HomeFeedPage._fallbackImages[index % HomeFeedPage._fallbackImages.length];

    return _FeedPost(
      postId: (data['post_id'] as String?) ?? '',
      author: 'Clutch Member',
      role: role[0].toUpperCase() + role.substring(1),
      title: caption.isNotEmpty ? caption : 'New post',
      body: caption,
      image: mediaUrl ?? fallbackImage,
      meta: postType.toUpperCase(),
      accent: _roleAccent(role),
      mediaType: postType.toUpperCase(),
      interactionsCount: (data['interactions_count'] as int?) ?? 0,
    );
  }

  _FeedPost copyWith({int? interactionsCount}) {
    return _FeedPost(
      postId: postId,
      author: author,
      role: role,
      title: title,
      body: body,
      image: image,
      meta: meta,
      accent: accent,
      mediaType: mediaType,
      interactionsCount: interactionsCount ?? this.interactionsCount,
    );
  }

  static Color _roleAccent(String role) {
    switch (role) {
      case 'school':
        return ClutchBrand.gold;
      case 'coach':
        return ClutchBrand.mint;
      case 'athlete':
        return ClutchBrand.ember;
      default:
        return ClutchBrand.ember;
    }
  }
}

class _FeedCard extends StatelessWidget {
  const _FeedCard({required this.post, required this.onInteract});

  final _FeedPost post;
  final VoidCallback onInteract;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      decoration: BoxDecoration(
        color: ClutchBrand.surfaceAlt,
        borderRadius: ClutchBrand.cardRadius,
        border: Border.all(color: ClutchBrand.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: post.accent.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(Icons.shield, color: post.accent),
                ),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(post.author, style: textTheme.titleMedium),
                    const SizedBox(height: 2),
                    Text(
                      post.role,
                      style: textTheme.labelLarge?.copyWith(color: post.accent),
                    ),
                  ],
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: ClutchBrand.surface,
                    borderRadius: ClutchBrand.chipRadius,
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.play_circle_fill, size: 14, color: post.accent),
                      const SizedBox(width: 6),
                      Text(post.mediaType, style: textTheme.labelLarge),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Container(
            height: 200,
            decoration: BoxDecoration(
              borderRadius: const BorderRadius.vertical(top: Radius.zero, bottom: Radius.circular(20)),
              image: DecorationImage(image: _imageProvider(post.image), fit: BoxFit.cover),
            ),
            child: Align(
              alignment: Alignment.bottomLeft,
              child: Container(
                margin: const EdgeInsets.all(12),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: ClutchBrand.ink.withOpacity(0.6),
                  borderRadius: ClutchBrand.chipRadius,
                ),
                child: Text(post.title, style: textTheme.labelLarge),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(post.title, style: textTheme.titleMedium),
                const SizedBox(height: 6),
                Text(
                  post.body,
                  style: textTheme.bodyMedium?.copyWith(color: ClutchBrand.frost.withOpacity(0.7)),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    GestureDetector(
                      onTap: onInteract,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: ClutchBrand.surface,
                          borderRadius: ClutchBrand.chipRadius,
                          border: Border.all(color: ClutchBrand.line),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.flash_on, size: 16, color: post.accent),
                            const SizedBox(width: 6),
                            const Text('Interact'),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      '${post.interactionsCount} interactions',
                      style: textTheme.labelLarge?.copyWith(color: ClutchBrand.frost.withOpacity(0.7)),
                    ),
                    const Spacer(),
                    Text(
                      post.meta,
                      style: textTheme.labelLarge?.copyWith(color: ClutchBrand.frost.withOpacity(0.6)),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
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
