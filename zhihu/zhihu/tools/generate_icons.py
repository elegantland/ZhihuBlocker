from cairosvg import svg2png # type: ignore
import os

# 确保 icons 目录存在
os.makedirs('icons', exist_ok=True)

# 图标尺寸
sizes = [32]

# 颜色配置
colors = {
    'enabled': '#2196F3',  # 明亮的蓝色
    'disabled': '#CCCCCC'  # 灰色
}

# 读取 SVG 模板
with open('icons/icon-template.svg', 'r') as f:
    svg_template = f.read()

# 生成不同状态和尺寸的图标
for state, color in colors.items():
    svg_content = svg_template.replace('currentColor', color)
    
    for size in sizes:
        output_file = f'icons/icon-{state}-{size}.png'
        svg2png(bytestring=svg_content.encode('utf-8'),
                write_to=output_file,
                output_width=size,
                output_height=size)
        print(f'Generated {output_file}') 