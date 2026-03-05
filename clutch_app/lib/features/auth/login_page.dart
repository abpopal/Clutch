import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../shared/clutched_background.dart';
import '../../shared/glassy_card.dart';
import '../../shared/gradient_button.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  static const List<String> _roles = ['Athlete', 'Scout'];

  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _zipController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _isLogin = false;
  bool _isLoading = false;
  String _selectedRole = _roles.first;
  String? _errorMessage;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _zipController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _errorMessage = null;
    });

    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final supabase = Supabase.instance.client;
      if (_isLogin) {
        await supabase.auth.signInWithPassword(
          email: _emailController.text.trim(),
          password: _passwordController.text.trim(),
        );
      } else {
        final roleValue = _selectedRole.toLowerCase();
        final response = await supabase.auth.signUp(
          email: _emailController.text.trim(),
          password: _passwordController.text.trim(),
          data: {
            'name': _nameController.text.trim(),
            'role': roleValue,
          },
        );

        final user = response.user;
        if (user == null) {
          throw AuthException('Sign up failed. Please try again.');
        }

        final userRow = await supabase
            .from('users')
            .insert({
              'firebase_uid': user.id,
              'role': roleValue,
            })
            .select('user_id')
            .single();

        final userId = userRow['user_id'] as String;
        if (roleValue == 'school') {
          await supabase.from('schools').insert({
            'user_id': userId,
            'name': _nameController.text.trim(),
          });
        } else if (roleValue == 'coach') {
          await supabase.from('coaches').insert({'user_id': userId});
        } else if (roleValue == 'athlete') {
          await supabase.from('athletes').insert({'user_id': userId});
        } else if (roleValue == 'scout') {
          await supabase.from('scouts').insert({'user_id': userId});
        }

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Sign up confirmed.')),
          );
        }

        await supabase.auth.signInWithPassword(
          email: _emailController.text.trim(),
          password: _passwordController.text.trim(),
        );
      }

      if (mounted) {
        if (Navigator.of(context).canPop()) {
          Navigator.of(context).pop();
        }
      }
    } on AuthException catch (e) {
      setState(() {
        _errorMessage = e.message ?? 'Authentication failed. Try again.';
      });
    } catch (_) {
      setState(() {
        _errorMessage = 'Something went wrong. Please try again.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  void _toggleMode() {
    setState(() {
      _isLogin = !_isLogin;
      _errorMessage = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          const Positioned.fill(child: ClutchedBackground()),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 36),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Column(
                    children: [
                      const Text(
                        'CLUTCHED',
                        style: TextStyle(
                          fontSize: 24,
                          letterSpacing: 2.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 20),
                      GlassyCard(
                        child: Form(
                          key: _formKey,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(
                                _isLogin ? 'Login' : 'Sign Up',
                                style: Theme.of(context).textTheme.headlineMedium,
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: 8),
                              Text(
                                _isLogin
                                    ? 'Welcome back. Enter your details.'
                                    : 'Enter your details to access Clutched.',
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  fontSize: 14,
                                  color: Color(0xFFC9C3C3),
                                ),
                              ),
                              if (_errorMessage != null) ...[
                                const SizedBox(height: 16),
                                Text(
                                  _errorMessage!,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    color: Color(0xFFB93A3A),
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                              const SizedBox(height: 24),
                              if (!_isLogin) ...[
                                _ClutchedField(
                                  controller: _nameController,
                                  hintText: 'Name',
                                  icon: Icons.person_outline,
                                  validator: (value) => _required(value, 'Name'),
                                ),
                                const SizedBox(height: 14),
                              ],
                              _ClutchedField(
                                controller: _emailController,
                                hintText: 'Email',
                                icon: Icons.mail_outline,
                                keyboardType: TextInputType.emailAddress,
                                validator: (value) => _required(value, 'Email'),
                              ),
                              const SizedBox(height: 14),
                              if (!_isLogin) ...[
                                Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 12,
                                        vertical: 14,
                                      ),
                                      decoration: _inputDecoration(),
                                      child: Row(
                                        children: const [
                                          Text(
                                            '+1',
                                            style: TextStyle(fontSize: 14),
                                          ),
                                          SizedBox(width: 6),
                                          Icon(Icons.keyboard_arrow_down, size: 18),
                                        ],
                                      ),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: _ClutchedField(
                                        controller: _phoneController,
                                        hintText: 'Phone',
                                        icon: Icons.phone_outlined,
                                        keyboardType: TextInputType.phone,
                                        validator: (value) => _required(value, 'Phone'),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 14),
                                _ClutchedField(
                                  controller: _zipController,
                                  hintText: 'Zip Code',
                                  icon: Icons.location_on_outlined,
                                  keyboardType: TextInputType.number,
                                  validator: (value) => _required(value, 'Zip Code'),
                                ),
                                const SizedBox(height: 14),
                              ],
                              _ClutchedField(
                                controller: _passwordController,
                                hintText: 'Password',
                                icon: Icons.lock_outline,
                                obscureText: true,
                                validator: (value) => _required(value, 'Password'),
                              ),
                              if (!_isLogin) ...[
                                const SizedBox(height: 22),
                                const Text(
                                  'Role',
                                  style: TextStyle(
                                    fontSize: 14,
                                    color: Color(0xFFC9C3C3),
                                  ),
                                ),
                                const SizedBox(height: 10),
                                Wrap(
                                  spacing: 10,
                                  runSpacing: 10,
                                  children: _roles
                                      .map(
                                        (role) => _RoleChip(
                                          label: role,
                                          selected: _selectedRole == role,
                                          onTap: () {
                                            setState(() {
                                              _selectedRole = role;
                                            });
                                          },
                                        ),
                                      )
                                      .toList(),
                                ),
                              ],
                              const SizedBox(height: 22),
                              GradientButton(
                                label: _isLogin ? 'Log in' : 'Create account',
                                onPressed: _isLoading ? () {} : _submit,
                              ),
                              const SizedBox(height: 14),
                              if (!_isLogin)
                                const Text(
                                  'By continuing, you agree to our Terms and Privacy Policy.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: Color(0xFFB8B0B0),
                                  ),
                                ),
                              const SizedBox(height: 16),
                              Center(
                                child: GestureDetector(
                                  onTap: _toggleMode,
                                  child: RichText(
                                    text: TextSpan(
                                      text: _isLogin
                                          ? 'Need an account? '
                                          : 'Already have an account? ',
                                      style: const TextStyle(
                                        color: Color(0xFFC9C3C3),
                                        fontSize: 13,
                                      ),
                                      children: [
                                        TextSpan(
                                          text: _isLogin ? 'Sign up' : 'Login',
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ClutchedField extends StatelessWidget {
  const _ClutchedField({
    required this.controller,
    required this.hintText,
    required this.icon,
    this.keyboardType,
    this.obscureText = false,
    this.validator,
  });

  final TextEditingController controller;
  final String hintText;
  final IconData icon;
  final TextInputType? keyboardType;
  final bool obscureText;
  final String? Function(String?)? validator;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      obscureText: obscureText,
      style: const TextStyle(fontSize: 14),
      validator: validator,
      decoration: InputDecoration(
        hintText: hintText,
        hintStyle: const TextStyle(color: Color(0xFF9A8F8F)),
        prefixIcon: Icon(icon, size: 20, color: const Color(0xFF9A8F8F)),
        filled: true,
        fillColor: const Color(0xFF1C1A1A),
        border: _outlineBorder(),
        enabledBorder: _outlineBorder(),
        focusedBorder: _outlineBorder(
          color: const Color(0xFFB52B2B),
          width: 1.3,
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),
    );
  }
}

class _RoleChip extends StatelessWidget {
  const _RoleChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFF261616) : const Color(0xFF1B1919),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? const Color(0xFFB52B2B) : const Color(0xFF2D2A2A),
            width: selected ? 1.3 : 1,
          ),
          boxShadow: selected
              ? [
                  const BoxShadow(
                    color: Color(0x4DB52B2B),
                    blurRadius: 10,
                    offset: Offset(0, 4),
                  ),
                ]
              : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (selected)
              const Icon(Icons.check_circle, size: 16, color: Color(0xFFB52B2B))
            else
              const Icon(Icons.circle_outlined, size: 16, color: Color(0xFF7E7777)),
            const SizedBox(width: 8),
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                color: selected ? Colors.white : const Color(0xFFCBC3C3),
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String? _required(String? value, String label) {
  if (value == null || value.trim().isEmpty) {
    return '$label is required';
  }
  return null;
}

OutlineInputBorder _outlineBorder({Color color = const Color(0xFF2F2A2A), double width = 1}) {
  return OutlineInputBorder(
    borderRadius: BorderRadius.circular(12),
    borderSide: BorderSide(color: color, width: width),
  );
}

BoxDecoration _inputDecoration() {
  return BoxDecoration(
    color: const Color(0xFF1C1A1A),
    borderRadius: BorderRadius.circular(12),
    border: Border.all(color: const Color(0xFF2F2A2A)),
  );
}
