import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'brand.dart';

class PostComposePage extends StatefulWidget {
  const PostComposePage({super.key, required this.image});

  final XFile image;

  @override
  State<PostComposePage> createState() => _PostComposePageState();
}

class _PostComposePageState extends State<PostComposePage> {
  final _captionController = TextEditingController();
  String _visibility = 'public';
  bool _isPosting = false;

  @override
  void dispose() {
    _captionController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _isPosting = true);
    try {
      final client = Supabase.instance.client;
      final authUser = client.auth.currentUser;
      if (authUser == null) {
        throw const AuthException('You need to be logged in.');
      }

      final roleValue = (authUser.userMetadata?['role'] as String?)?.toLowerCase() ?? 'athlete';
      final existingUser = await client
          .from('users')
          .select('user_id, role')
          .eq('firebase_uid', authUser.id)
          .maybeSingle();

      final userRow = existingUser ??
          await client
              .from('users')
              .insert({
                'firebase_uid': authUser.id,
                'role': roleValue,
              })
              .select('user_id, role')
              .single();

      final userId = userRow['user_id'] as String;
      final role = (userRow['role'] as String?) ?? roleValue;

      final postRow = await client
          .from('post')
          .insert({
            'author_user_id': userId,
            'author_role': role,
            'caption': _captionController.text.trim(),
            'post_type': 'image',
            'visibility': _visibility,
            'interactions_count': 0,
          })
          .select('post_id')
          .single();

      final postId = postRow['post_id'] as String;
      final filePath = 'posts/$userId/${DateTime.now().millisecondsSinceEpoch}.jpg';
      final file = File(widget.image.path);
      await client.storage.from('post-media').upload(filePath, file);
      final publicUrl = client.storage.from('post-media').getPublicUrl(filePath);

      await client.from('post_media').insert({
        'post_id': postId,
        'media_url': publicUrl,
        'media_type': 'image',
        'duration_seconds': null,
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Post created.')),
        );
        Navigator.of(context).pop();
      }
    } on AuthException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message)),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not create post: $error')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isPosting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: ClutchBrand.surfaceAlt,
        title: const Text('New Post'),
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        children: [
          Container(
            height: 220,
            decoration: BoxDecoration(
              borderRadius: ClutchBrand.cardRadius,
              image: DecorationImage(
                image: FileImage(File(widget.image.path)),
                fit: BoxFit.cover,
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text('Caption', style: textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            controller: _captionController,
            maxLines: 4,
            decoration: InputDecoration(
              hintText: 'Add a caption...',
              filled: true,
              fillColor: ClutchBrand.surfaceAlt,
              border: OutlineInputBorder(
                borderRadius: ClutchBrand.cardRadius,
                borderSide: BorderSide(color: ClutchBrand.line),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: ClutchBrand.cardRadius,
                borderSide: BorderSide(color: ClutchBrand.line),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text('Visibility', style: textTheme.titleMedium),
          const SizedBox(height: 8),
          Wrap(
            spacing: 10,
            children: [
              _VisibilityChip(
                label: 'Public',
                isSelected: _visibility == 'public',
                onTap: () => setState(() => _visibility = 'public'),
              ),
              _VisibilityChip(
                label: 'Followers',
                isSelected: _visibility == 'followers',
                onTap: () => setState(() => _visibility = 'followers'),
              ),
              _VisibilityChip(
                label: 'Private',
                isSelected: _visibility == 'private',
                onTap: () => setState(() => _visibility = 'private'),
              ),
            ],
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _isPosting ? null : _submit,
            style: FilledButton.styleFrom(
              backgroundColor: ClutchBrand.ember,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            child: _isPosting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Post'),
          ),
        ],
      ),
    );
  }
}

class _VisibilityChip extends StatelessWidget {
  const _VisibilityChip({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? ClutchBrand.ember.withOpacity(0.2) : ClutchBrand.surfaceAlt,
          borderRadius: ClutchBrand.chipRadius,
          border: Border.all(color: isSelected ? ClutchBrand.ember : ClutchBrand.line),
        ),
        child: Text(label, style: textTheme.labelLarge),
      ),
    );
  }
}
