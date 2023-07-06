import os
import re
import jinja2


def process_jinja_template(template_str):

    template = jinja2.Template(
        template_str, trim_blocks=True, lstrip_blocks=True, keep_trailing_newline=True)

    rendered_content = template.render()
    s = rendered_content.replace("\n\n\n", "\n\n")
    while s != rendered_content:
        rendered_content = s
        s = rendered_content.replace("\n\n\n", "\n\n")

    return rendered_content


if __name__ == "__main__":

    j2file_pattern = re.compile(r".*\.j2(?:.*)?\.ya?ml$")
    root_dir = "."

    for root, _, files in os.walk(root_dir):
        for file in files:
            if j2file_pattern.match(file):
                input_file = os.path.join(root, file)
                output_file = os.path.join(root, file.replace(".j2", ""))

                with open(input_file, "r") as f:
                    template_str = f.read()

                rendered_content = process_jinja_template(
                    template_str)

                with open(output_file, "w") as f:
                    f.write(rendered_content)
