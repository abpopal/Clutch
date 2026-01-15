import 'dart:math';

import 'package:flutter/material.dart';

class ClutchedBackground extends StatelessWidget {
  const ClutchedBackground({super.key});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _DustPainter(),
      child: Container(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment.topCenter,
            radius: 1.2,
            colors: [Color(0xFF2A2222), Color(0xFF0F0D0D)],
          ),
        ),
      ),
    );
  }
}

class _DustPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final darkPaint = Paint()..color = const Color(0xFF1A1414).withOpacity(0.4);
    canvas.drawRect(Offset.zero & size, darkPaint);

    final random = Random(12);
    final paint = Paint()..style = PaintingStyle.fill;
    for (var i = 0; i < 220; i++) {
      final radius = random.nextDouble() * 2 + 0.5;
      final dx = random.nextDouble() * size.width;
      final dy = random.nextDouble() * size.height;
      final isWarm = random.nextBool();
      paint.color = isWarm
          ? const Color(0xFF7C2A2A).withOpacity(0.4)
          : const Color(0xFF3A3232).withOpacity(0.5);
      canvas.drawCircle(Offset(dx, dy), radius, paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
