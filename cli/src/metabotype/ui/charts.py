"""Terminal charts with calendar spacing and separate measurement scales."""
from statistics import median


def compact_series(values, columns, step=False):
    """Aggregate WPM into calendar intervals without shifting observation dates.

    Place each interval's median at its last observed day, leaving the original
    timeline length intact. Levels keep every change, including brief reversals.
    """
    if columns < 1:
        raise ValueError("Chart width must be positive")
    if step or len(values) <= columns:
        return list(values)
    result = [None] * len(values)
    for column in range(columns):
        start = column * len(values) // columns
        end = (column + 1) * len(values) // columns
        observed = [(i, values[i]) for i in range(start, end) if values[i] is not None]
        if observed:
            result[observed[-1][0]] = median(value for _, value in observed)
    return result


def chart_rows(values, width, height, maximum, minimum=0, step=False, unicode=True):
    """Draw observations at calendar positions, connecting across unplayed days.

    Connections are visual only: no values are filled or extrapolated. Braille
    gives WPM lines 2 x 4 dots per cell; discrete levels use crisp stair steps.
    """
    grid = [[" "] * width for _ in range(height)]
    if not values or width < 1 or height < 1:
        return ["".join(row) for row in grid]
    span = maximum - minimum or 1
    sx, sy = (2, 4) if unicode and not step else (1, 1)
    points = []
    for index, value in enumerate(values):
        if value is not None:
            x = round((index / (len(values) - 1) if len(values) > 1 else 0.5) * (width * sx - 1))
            y = height * sy - 1 - round(
                (min(maximum, max(minimum, value)) - minimum) / span * (height * sy - 1))
            points.append((x, y))
    if not points:
        return ["".join(row) for row in grid]

    pixels = [[0] * width for _ in range(height)]
    dots = ((1, 8), (2, 16), (4, 32), (64, 128))

    def dot(x, y):
        pixels[y // sy][x // sx] |= dots[y % 4][x % 2] if sx == 2 else 1

    def segment(a, b):
        x, y = a
        dx, dy = b[0] - x, b[1] - y
        count = max(abs(dx), abs(dy))
        for offset in range(count + 1):
            dot(x + round(dx * offset / max(1, count)),
                y + round(dy * offset / max(1, count)))

    if step:
        # Edge masks preserve corners even when several changes share a cell.
        edges = [[0] * width for _ in range(height)]
        for (px, py), (x, y) in zip(points, points[1:]):
            for cx in range(px, x):
                edges[py][cx] |= 2
                edges[py][cx + 1] |= 8
            for cy in range(min(py, y), max(py, y)):
                edges[cy][x] |= 4
                edges[cy + 1][x] |= 1
        glyphs = " ╵╶└╷│┌├╴┘─┴┐┤┬┼"
        for y in range(height):
            for x in range(width):
                mask = edges[y][x]
                if mask:
                    if unicode:
                        grid[y][x] = glyphs[mask]
                    else:
                        grid[y][x] = "+" if mask & 5 and mask & 10 else "|" if mask & 5 else "-"
    else:
        for point in points:
            dot(*point)
        for a, b in zip(points, points[1:]):
            segment(a, b)
        for y in range(height):
            for x in range(width):
                if pixels[y][x]:
                    grid[y][x] = chr(0x2800 + pixels[y][x]) if unicode else "*"

    # Dense markers obscure the line. Always mark its most recent observation.
    marked = points if not step and len(points) <= width // 3 else points[-1:]
    for x, y in marked:
        grid[y // sy][x // sx] = "●" if unicode else "o"
    return ["".join(row) for row in grid]
