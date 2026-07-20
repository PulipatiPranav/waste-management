import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// A shimmering placeholder block. Skeletons over spinners for content that has shape:
/// a customer waiting on their wallet sees the layout it will fill, which reads as
/// faster and less jarring than a centred spinner that then snaps to a full screen.
///
/// Self-animating and self-disposing — drop it in and remove it when data arrives.
class Skeleton extends StatefulWidget {
  const Skeleton({required this.width, required this.height, this.radius = AppRadii.sm, super.key});

  const Skeleton.line({this.width = double.infinity, super.key})
    : height = 14,
      radius = AppRadii.sm;

  final double width;
  final double height;
  final double radius;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final t = Curves.easeInOut.transform(_controller.value);
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            color: Color.lerp(scheme.surfaceContainerHighest, scheme.surfaceContainerHigh, t),
            borderRadius: BorderRadius.circular(widget.radius),
          ),
        );
      },
    );
  }
}

/// A stack of skeleton lines — the common "loading a card of text" case.
class SkeletonList extends StatelessWidget {
  const SkeletonList({this.lines = 3, super.key});

  final int lines;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < lines; i++) ...[
          Skeleton.line(width: i.isEven ? double.infinity : 180),
          if (i < lines - 1) const SizedBox(height: AppSpacing.sm),
        ],
      ],
    );
  }
}
